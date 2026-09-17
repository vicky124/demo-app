import { MemoryStore } from "../src/storage/MemoryStore";
import { describeEndpointContract } from "./helpers/endpointContract";

describeEndpointContract(
  "memory",
  () => new MemoryStore(),
  (store) => (store as MemoryStore).close()
);
