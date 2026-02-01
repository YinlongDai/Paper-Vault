import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.AUTH_GITHUB_ID ?? "",
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
    }),
  ],
  secret: process.env.AUTH_SECRET,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile && typeof (profile as any).login === "string") {
        (token as any).login = (profile as any).login;
      }
      return token;
    },
    async session({ session, token }) {
      const login = String((token as any).login ?? "").trim();
      if (session.user) {
        (session.user as any).login = login;
        if (login) session.user.name = login;
      }
      return session;
    },
  },
};