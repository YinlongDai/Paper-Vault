import { NextResponse } from "next/server";
import { getViewer } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getViewer());
}
