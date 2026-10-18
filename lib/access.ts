// Access control for the local build: there is no login, the person running it can edit everything.
// (The hosted paper-vault ships its own version of this file backed by GitHub login.)
import { NextResponse } from "next/server";

export type Viewer = {
  authEnabled: boolean;
  signedIn: boolean;
  canEdit: boolean;
  name: string;
};

export async function getViewer(): Promise<Viewer> {
  return { authEnabled: false, signedIn: true, canEdit: true, name: "" };
}

/** Returns a 401/403 response when the caller may not edit, otherwise null. */
export async function denyUnlessEditor(): Promise<NextResponse | null> {
  return null;
}
