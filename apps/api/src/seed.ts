import argon2 from "argon2";
import { eq, inArray } from "drizzle-orm";
import {
  createDatabase,
  indexes,
  memberships,
  organizations,
  projects,
  searchClicks,
  searchEvents,
  synonymSets,
  users
} from "@searchforge/db";

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) throw new Error("POSTGRES_URL is required");

const production = process.env.NODE_ENV === "production";
if (production && process.env.SEARCHFORGE_ALLOW_DEMO_SEED !== "true") {
  throw new Error("Refusing to seed demo data in production. Set SEARCHFORGE_ALLOW_DEMO_SEED=true to opt in explicitly.");
}

const demoPassword = process.env.SEARCHFORGE_DEMO_PASSWORD ?? "SearchForgeDemo123!";
const { db, pool } = createDatabase(postgresUrl);

const DEMO_ORG_SLUGS = ["searchforge-demo", "searchforge-labs"];
const DEMO_EMAILS = ["owner@searchforge.local", "analyst@searchforge.local"];

function daysAgo(days: number, hour = 12) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function main() {
  const passwordHash = await argon2.hash(demoPassword, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });

  const seeded = await db.transaction(async tx => {
    const oldOrganizations = await tx.select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.slug, DEMO_ORG_SLUGS));
    if (oldOrganizations.length > 0) {
      await tx.delete(organizations).where(inArray(organizations.id, oldOrganizations.map(row => row.id)));
    }
    await tx.delete(users).where(inArray(users.email, DEMO_EMAILS));

    const [owner, analyst] = await tx.insert(users).values([
      {
        email: DEMO_EMAILS[0]!,
        displayName: "SearchForge Demo Owner",
        passwordHash,
        emailVerifiedAt: new Date()
      },
      {
        email: DEMO_EMAILS[1]!,
        displayName: "SearchForge Demo Analyst",
        passwordHash,
        emailVerifiedAt: new Date()
      }
    ]).returning();
    if (!owner || !analyst) throw new Error("Failed to create demo users");

    const [demoOrg, labsOrg] = await tx.insert(organizations).values([
      { name: "SearchForge Demo", slug: DEMO_ORG_SLUGS[0]! },
      { name: "SearchForge Labs", slug: DEMO_ORG_SLUGS[1]! }
    ]).returning();
    if (!demoOrg || !labsOrg) throw new Error("Failed to create demo organizations");

    await tx.insert(memberships).values([
      { organizationId: demoOrg.id, userId: owner.id, role: "owner" },
      { organizationId: demoOrg.id, userId: analyst.id, role: "developer" },
      { organizationId: labsOrg.id, userId: analyst.id, role: "owner" },
      { organizationId: labsOrg.id, userId: owner.id, role: "viewer" }
    ]);

    const [docsProject, labsProject] = await tx.insert(projects).values([
      {
        organizationId: demoOrg.id,
        name: "Docs Search",
        slug: "docs-search",
        description: "Bilingual documentation search demo with seeded analytics.",
        defaultLanguage: "auto",
        supportedLanguages: ["en", "ar"],
        analyticsEnabled: true
      },
      {
        organizationId: labsOrg.id,
        name: "Product Catalog",
        slug: "product-catalog",
        description: "Second tenant used to demonstrate project and organization isolation.",
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        analyticsEnabled: true
      }
    ]).returning();
    if (!docsProject || !labsProject) throw new Error("Failed to create demo projects");

    const [docsIndex, labsIndex] = await tx.insert(indexes).values([
      {
        projectId: docsProject.id,
        name: "Documentation",
        slug: "docs",
        schema: { title: "string", content: "string", language: "string", category: "string" }
      },
      {
        projectId: labsProject.id,
        name: "Products",
        slug: "products",
        schema: { name: "string", description: "string", category: "string", price: "number" }
      }
    ]).returning();
    if (!docsIndex || !labsIndex) throw new Error("Failed to create demo indexes");

    await tx.insert(synonymSets).values([
      { projectId: docsProject.id, name: "Search terminology", terms: ["search", "find", "lookup"], oneWay: false, enabled: true },
      { projectId: docsProject.id, name: "Arabic search terminology", terms: ["بحث", "استعلام", "إيجاد"], oneWay: false, enabled: true },
      { projectId: docsProject.id, name: "API abbreviation", terms: ["api", "application programming interface"], oneWay: false, enabled: true },
      { projectId: labsProject.id, name: "Catalog terminology", terms: ["product", "item", "sku"], oneWay: false, enabled: true }
    ]);

    const eventRows = [
      ...Array.from({ length: 8 }, (_, index) => ({ query: "search api", days: index % 6, results: 14 - (index % 3), latency: 18 + index })),
      ...Array.from({ length: 5 }, (_, index) => ({ query: "محرك بحث", days: index % 5, results: 9 - (index % 2), latency: 24 + index })),
      ...Array.from({ length: 4 }, (_, index) => ({ query: "autocomplete", days: index % 4, results: 7, latency: 12 + index })),
      ...Array.from({ length: 3 }, (_, index) => ({ query: "zero result example", days: index + 1, results: 0, latency: 10 + index })),
      { query: "invoice 8472", days: 2, results: 1, latency: 21 }
    ];

    const insertedEvents = await tx.insert(searchEvents).values(eventRows.map((event, index) => ({
      projectId: docsProject.id,
      indexId: docsIndex.id,
      query: event.query,
      language: /[\u0600-\u06ff]/.test(event.query) ? "ar" : "en",
      resultCount: event.results,
      latencyMs: event.latency,
      createdAt: daysAgo(event.days, 9 + (index % 8))
    }))).returning({ id: searchEvents.id, query: searchEvents.query, createdAt: searchEvents.createdAt });

    const clickable = insertedEvents.filter(event => event.query !== "zero result example" && event.query !== "invoice 8472");
    await tx.insert(searchClicks).values(clickable.slice(0, 11).map((event, index) => ({
      projectId: docsProject.id,
      query: event.query,
      documentId: `demo-doc-${(index % 5) + 1}`,
      position: (index % 4) + 1,
      searchEventId: event.id,
      createdAt: new Date(event.createdAt.getTime() + 30_000)
    })));

    await tx.insert(searchEvents).values([
      { projectId: labsProject.id, indexId: labsIndex.id, query: "wireless keyboard", language: "en", resultCount: 12, latencyMs: 16, createdAt: daysAgo(1) },
      { projectId: labsProject.id, indexId: labsIndex.id, query: "wireless keyboard", language: "en", resultCount: 12, latencyMs: 15, createdAt: daysAgo(2) },
      { projectId: labsProject.id, indexId: labsIndex.id, query: "wireless keyboard", language: "en", resultCount: 12, latencyMs: 17, createdAt: daysAgo(3) }
    ]);

    return {
      ownerEmail: owner.email,
      analystEmail: analyst.email,
      organizations: [demoOrg.slug, labsOrg.slug],
      projects: [docsProject.slug, labsProject.slug],
      analyticsEvents: eventRows.length + 3
    };
  });

  console.log(JSON.stringify({
    seeded: true,
    ...seeded,
    passwordSource: process.env.SEARCHFORGE_DEMO_PASSWORD ? "SEARCHFORGE_DEMO_PASSWORD" : "development default"
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
