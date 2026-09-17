# Deploying to AWS

This guide deploys the app to a single **EC2 instance running Docker Compose** —
the same `docker-compose.yml` you already use locally (app + Redis together),
just running on a public AWS host instead of your laptop. This is the
recommended path for this project: it needs no AWS networking knowledge beyond
one security group, stays inside the AWS free tier, and gives you a public URL
in about 15 minutes.

An alternative, more "cloud-native" path (AWS App Runner + ECR + ElastiCache)
is sketched at the end for reference, but involves meaningfully more AWS
plumbing (VPC connectors for private ElastiCache access) for the same result —
not recommended unless you specifically want to practice those services.

---

## Prerequisites

- An AWS account with permission to create EC2 instances and security groups.
- An SSH key pair (you'll create one in the console if you don't have one).
- This repository pushed to GitHub (already done — `vicky124/demo-app`).
- Since the repo is **private**, you'll need either a GitHub Personal Access
  Token or an SSH deploy key to `git clone` it from the EC2 instance (§4 covers
  this). If you'd rather skip that entirely, `scp` the project folder up
  instead (also noted in §4).

---

## 1. Launch the EC2 instance

1. AWS Console → **EC2** → **Launch instance**.
2. **Name**: `demo-app`.
3. **AMI**: Amazon Linux 2023 (free tier eligible).
4. **Instance type**: `t3.micro` (or `t2.micro` — both free-tier eligible).
5. **Key pair**: create a new one (e.g. `demo-app-key`), download the `.pem`
   file, keep it safe — you can't re-download it later.
6. **Network settings** → click **Edit** and configure the security group
   (or create a new one) with these inbound rules:

   | Type | Port | Source | Purpose |
   |---|---|---|---|
   | SSH | 22 | My IP | so only you can SSH in |
   | Custom TCP | 3000 | Anywhere (0.0.0.0/0) | so the reviewer can reach the API |

7. **Storage**: default 8 GiB is plenty.
8. Click **Launch instance**. Wait for **Instance state: Running** and note
   its **Public IPv4 address**.

---

## 2. Connect to the instance

```bash
chmod 400 demo-app-key.pem
ssh -i demo-app-key.pem ec2-user@<PUBLIC_IP>
```

(On Windows, use Git Bash for this — the same shell you've been using for
`curl` — or PuTTY if you prefer.)

---

## 3. Install Docker and the Compose plugin

Run these on the EC2 instance (Amazon Linux 2023):

```bash
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
```

Log out and back in (`exit`, then SSH in again) so the group change takes
effect without needing `sudo` for every docker command:

```bash
exit
ssh -i demo-app-key.pem ec2-user@<PUBLIC_IP>
```

Install the Compose plugin:

```bash
mkdir -p ~/.docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o ~/.docker/cli-plugins/docker-compose
chmod +x ~/.docker/cli-plugins/docker-compose
docker compose version   # sanity check
```

---

## 4. Get the code onto the instance

**Option A — git clone with a Personal Access Token** (repo is private):

1. On GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens** → generate one scoped to read-only access on
   `vicky124/demo-app`.
2. On the EC2 instance:
   ```bash
   git clone https://<YOUR_TOKEN>@github.com/vicky124/demo-app.git
   cd demo-app
   ```
   (The token is embedded in the URL only for this one clone command —
   avoid putting it in `git remote -v` output you share with anyone.)

**Option B — copy the folder up directly, no GitHub auth needed:**

From your own machine (not the EC2 instance):

```bash
scp -i demo-app-key.pem -r "D:/workspace/api-throttling-service" ec2-user@<PUBLIC_IP>:~/demo-app
```

Then `ssh` back in and `cd demo-app`.

---

## 5. Build and run

```bash
cd ~/demo-app
docker compose up --build -d
docker compose ps       # both "app" and "redis" should show "running"
docker compose logs -f app   # ctrl-C to stop tailing, doesn't stop the app
```

`-d` runs it detached (survives you logging out); `restart: unless-stopped` in
`docker-compose.yml` means both containers also come back automatically if the
instance reboots.

---

## 6. Verify it's reachable

From your own machine:

```bash
curl -i http://<PUBLIC_IP>:3000/foo -H "Authorization: bearer client-a"
curl -i http://<PUBLIC_IP>:3000/bar -H "Authorization: bearer client-b"
```

Run through the same demo matrix as [README.md §6](./README.md#6-demo-script--all-combinations)
against `http://<PUBLIC_IP>:3000` instead of `localhost:3000`. Because
`STORAGE_DRIVER=redis` here, you can also demonstrate persistence per
[README.md §3](./README.md#3-running-with-redis-persistent-storage-strategy):

```bash
# on the EC2 instance
docker compose restart app   # restarts only the app container, Redis keeps running
# immediately from your machine — counters from before the restart are still there
curl -i http://<PUBLIC_IP>:3000/foo -H "Authorization: bearer client-b"
```

---

## 7. Updating after a code change

```bash
# on the EC2 instance, inside ~/demo-app
git pull                       # if you used Option A
docker compose up --build -d   # rebuilds only what changed, restarts containers
```

---

## 8. Cost and cleanup

- `t3.micro`/`t2.micro` is free-tier eligible (750 instance-hours/month for
  your first 12 months on the account). Outside the free tier it's a few
  cents/hour.
- **When you're done demoing it, stop or terminate the instance** (EC2 console
  → select instance → **Instance state → Terminate**) so it doesn't keep
  running (and, once your free-tier window ends, costing money) indefinitely.
- Terminating deletes the instance and its data — that's fine here since
  nothing on it needs to be kept once the reviewer has seen it working.

---

## Alternative: App Runner + ECR + ElastiCache (more AWS-native, more setup)

For reference only — not needed for this task, but useful if you want a
managed/serverless deployment instead of a server you maintain:

1. `docker build -t demo-app .` locally, then push the image to a private
   **Amazon ECR** repository (`aws ecr create-repository`, `docker push`).
2. Create an **App Runner** service pointing at that ECR image, with
   `STORAGE_DRIVER=redis` and `REDIS_URL` as environment variables.
3. Create an **ElastiCache for Redis** cluster (`cache.t3.micro`). ElastiCache
   has no public endpoint by design, so App Runner needs a **VPC connector**
   configured to reach the subnet ElastiCache lives in — this is the part
   that adds real complexity compared to the EC2 path above (subnets, route
   tables, security groups between App Runner's VPC connector and
   ElastiCache's security group).
4. App Runner gives you an HTTPS URL automatically (no security group/port
   config needed on your end), auto-scales, and you never SSH into anything —
   at the cost of the VPC/ElastiCache setup in step 3.

If you want to pursue this route in detail, say so and I'll write it out as
fully as the EC2 guide above.
