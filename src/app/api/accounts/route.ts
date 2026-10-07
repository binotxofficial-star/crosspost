import { listAccounts } from "@/lib/accounts";
import { configuredPlatforms, maxUploadBytes } from "@/lib/config";
import { getUserId } from "@/lib/session";

export async function GET() {
  return Response.json({
    configured: configuredPlatforms(),
    accounts: await listAccounts(await getUserId()),
    maxUploadBytes: maxUploadBytes(),
  });
}
