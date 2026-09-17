import "dotenv/config";
import { createApp } from "./app";
import { createStore, StorageDriver } from "./storage";

const PORT = Number(process.env.PORT ?? 3000);
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER ?? "memory") as StorageDriver;
const REDIS_URL = process.env.REDIS_URL;

const store = createStore(STORAGE_DRIVER, REDIS_URL);
const app = createApp(store);

app.listen(PORT, () => {
  console.log(`API throttling service listening on port ${PORT} (storage driver: ${STORAGE_DRIVER})`);
});
