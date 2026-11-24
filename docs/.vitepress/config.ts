import { defineConfig } from "vitepress";

const repo = "https://github.com/baraka-mshindi/google";

// The guides live in docs/guides so the README's relative links keep working. The changelog is
// included from CHANGELOG.md at the repository root, so it cannot drift from the site.
export default defineConfig({
  title: "@mshindi-labs/google",
  description:
    "Multi-tenant Google API utilities for TypeScript: per-tenant OAuth, envelope-encrypted tokens, Gmail, Calendar and Sheets.",
  // Served as a GitHub Pages project site.
  base: "/google/",
  cleanUrls: true,
  lastUpdated: true,
  // Internal design plans and specs are not part of the published docs.
  srcExclude: ["superpowers/**"],
  rewrites: { "SPEC.md": "spec.md" },
  markdown: {
    // Release notes are generated from commit messages and can contain generics outside code
    // spans. Vue would read <T> as an unclosed element and fail the build, so inline HTML is
    // rendered as text. Block HTML (comments) is unaffected.
    config(md) {
      md.renderer.rules.html_inline = (tokens, index) =>
        md.utils.escapeHtml(tokens[index].content);
    },
  },
  themeConfig: {
    nav: [
      { text: "Getting started", link: "/getting-started" },
      { text: "Guides", link: "/guides/host-integration" },
      { text: "Design spec", link: "/spec" },
      { text: "Changelog", link: "/changelog" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [{ text: "Getting started", link: "/getting-started" }],
      },
      {
        text: "Guides",
        items: [
          { text: "Tenant setup", link: "/guides/tenant-setup" },
          { text: "Host integration", link: "/guides/host-integration" },
          { text: "Calendar scheduling", link: "/guides/calendar-scheduling" },
          { text: "Google Sheets", link: "/guides/sheets" },
          { text: "Bulk sending", link: "/guides/bulk-sending" },
          { text: "Prisma and TypeORM", link: "/guides/orm-integration" },
          { text: "Postgres row-level security", link: "/guides/postgres-rls" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Design spec", link: "/spec" },
          { text: "Changelog", link: "/changelog" },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: "local" },
    socialLinks: [
      { icon: "github", link: repo },
      {
        icon: "npm",
        link: "https://www.npmjs.com/package/@mshindi-labs/google",
      },
    ],
    editLink: {
      // Serialized into the client bundle, so it cannot close over `repo`.
      pattern: ({ filePath }) =>
        `https://github.com/baraka-mshindi/google/edit/main/${
          filePath === "changelog.md" ? "CHANGELOG.md" : `docs/${filePath}`
        }`,
      text: "Edit this page on GitHub",
    },
    footer: { message: "Released under the MIT License." },
  },
});
