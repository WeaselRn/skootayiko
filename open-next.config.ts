import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Pages are static and API responses are not cached by Next, so no incremental cache store is needed.
export default defineCloudflareConfig();
