# Deploying to AWS

This guide deploys the app to a single **EC2 instance running Docker Compose** —
the same `docker-compose.yml` you already use locally (app + Redis together),
just running on a public AWS host instead of your laptop. This is the
recommended path for this project: it needs no AWS networking knowledge beyond
one security group, stays inside the AWS free tier, and gives you a public URL
in about 15 minutes.

§9 covers setting up **CI/CD** on top of this (GitHub Actions runs the test
suite on every push/PR, then auto-deploys to this same EC2 instance on a
successful push to `master`).

An alternative, more "cloud-native" deployment path (AWS App Runner + ECR +
ElastiCache) is sketched at the end for reference, but involves meaningfully
more AWS plumbing (VPC connectors for private ElastiCache access) for the same
result — not recommended unless you specifically want to practice those
services.

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

## 9. CI/CD pipeline (GitHub Actions → EC2)

This automates §7 ("Updating after a code change") so every push to `master`
that passes tests is deployed automatically, with no manual SSH step. The
workflow file is already in the repo at
[`.github/workflows/ci-cd.yml`](./.github/workflows/ci-cd.yml) and has two jobs:

- **`test`** — runs on every push and pull request against `master`: `npm ci`,
  `npm run build`, `npm test`. This is the CI gate; a PR with failing tests
  shows a red X and nothing deploys.
- **`deploy`** — runs only on a push to `master`, only after `test` passes.
  SSHes into the EC2 instance and runs `git fetch && git reset --hard
  origin/master && docker compose up --build -d`.

### A security trade-off you need to decide on first

GitHub-hosted Actions runners don't have a fixed IP address — they come from a
large, changing range. The security group rule from §1 (`SSH: 22, source = My
IP`) was written for *your* SSH access and will silently block the `deploy`
job, since it isn't coming from your IP. You have two options:

- **A. Open port 22 to the internet** (simplest, used below) — key-based auth
  still protects it (no password login is configured), and this is a demo
  instance you'll terminate afterward per §8, but it is a real trade-off: any
  IP on the internet can attempt to connect, not just GitHub's.
- **B. Use AWS Systems Manager (SSM) instead of SSH** — no inbound port needed
  at all. More secure, more setup. Outlined at the end of this section.

If you're fine with (A), update the security group: EC2 console → your
instance → **Security** tab → the security group → **Edit inbound rules** →
either change the existing SSH rule's source to **Anywhere (0.0.0.0/0)**, or
add a second SSH rule for it and leave "My IP" as well.

### 9.1 Set up repo access for automated pulls

The `deploy` job runs `git fetch`/`git reset --hard` **on the EC2 instance**,
so the instance needs durable, non-interactive access to the private repo. If
you used §4 Option B (`scp`, no git remote at all) or want to replace a PAT
embedded in a URL (§4 Option A) with something that doesn't expire silently,
set up a **deploy key** instead:

```bash
# on the EC2 instance
ssh-keygen -t ed25519 -C "demo-app-ec2-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy that public key into **GitHub → your repo → Settings → Deploy keys → Add
deploy key** (read-only is enough). Then point the repo's remote at SSH
instead of HTTPS:

```bash
# on the EC2 instance, inside ~/demo-app (or git clone git@github.com:vicky124/demo-app.git ~/demo-app if you haven't cloned yet)
git remote set-url origin git@github.com:vicky124/demo-app.git
ssh -T git@github.com   # first-time host key confirmation; type "yes"
git fetch origin master
```

### 9.2 Add GitHub Actions secrets

**Repo → Settings → Secrets and variables → Actions → New repository secret**,
add:

| Secret | Value |
|---|---|
| `EC2_HOST` | the instance's public IPv4 address |
| `EC2_USER` | `ec2-user` |
| `EC2_SSH_KEY` | the full contents of `demo-app-key.pem` (the key you use to SSH in — the same one from §1/§2, *not* the deploy key from §9.1, which is a separate key for GitHub→EC2 repo access) |

### 9.3 Push and watch it run

```bash
git add .
git commit -m "trigger pipeline"
git push origin master
```

**GitHub → your repo → Actions tab** shows the workflow running: `test` first,
then `deploy` once `test` is green. On success, verify the same way as §6:

```bash
curl -i http://<PUBLIC_IP>:3000/foo -H "Authorization: bearer client-a"
```

### 9.4 Rolling back a bad deploy

Automated deploys mean a broken `master` gets shipped automatically too. To
roll back:

```bash
git revert <bad-commit-sha>
git push origin master   # ships a new commit that undoes it, redeploys automatically
```

or, for an immediate manual fix without waiting on CI, SSH in directly and
check out the last known-good commit, then `docker compose up --build -d`.

### 9.5 More secure alternative: deploy via AWS Systems Manager, no open SSH port

Instead of `appleboy/ssh-action`, GitHub Actions can trigger a command on the
instance through **SSM Run Command**, which uses IAM credentials rather than
an open network port:

1. Attach an IAM role with the `AmazonSSMManagedInstanceCore` policy to the
   EC2 instance (EC2 console → instance → **Actions → Security → Modify IAM
   role**). Amazon Linux 2023 already runs the SSM agent, so no extra install
   is needed on the box.
2. Create an IAM user (or, better, an OIDC-federated role so no long-lived
   keys are needed) with permission to call `ssm:SendCommand` and
   `ssm:GetCommandInvocation`, scoped to that instance's ARN.
3. Store the credentials as GitHub secrets and use
   `aws-actions/configure-aws-credentials` in the workflow, then call:
   ```bash
   aws ssm send-command \
     --instance-ids <INSTANCE_ID> \
     --document-name "AWS-RunShellScript" \
     --parameters 'commands=["cd /home/ec2-user/demo-app","git fetch origin master","git reset --hard origin/master","docker compose up --build -d"]'
   ```
4. Remove the port-22 rule from the security group entirely — SSM doesn't
   need it, closing the exposure that option (A) above accepted.

This trades a security-group shortcut for IAM setup; worth it if this were a
longer-lived deployment rather than a task demo.

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
