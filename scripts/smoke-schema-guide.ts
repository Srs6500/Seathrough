import assert from "node:assert/strict";
import { heuristicAsk } from "../src/lib/schema-guide/ask";
import { heuristicBackendAsk } from "../src/lib/schema-guide/backendAsk";
import {
  buildBackendStories,
  scenarioPath,
} from "../src/lib/schema-guide/backendStory";
import { buildGuideFromFiles } from "../src/lib/schema-guide/buildGuide";
import {
  buildKnowledgeGraph,
  queryKnowledgeGraph,
} from "../src/lib/schema-guide/knowledgeGraph";
import { buildExploreStory, buildOverviewStory } from "../src/lib/schema-guide/overviewStory";
import { parsePrismaSchema } from "../src/lib/schema-guide/parsePrisma";
import { sampleProjectFiles } from "../src/lib/schema-guide/sampleProject";

const files = sampleProjectFiles();
const parsed = parsePrismaSchema(files[0]!.content);
assert.equal(parsed.provider, "postgresql");
assert.equal(parsed.models.length, 5);
assert.ok(parsed.models.some((model) => model.modelName === "Order"));
assert.equal(
  parsed.models.find((model) => model.modelName === "Order")?.doc,
  "Stores each purchase a customer makes.",
);

const declared = parsed.relations.filter((rel) => rel.origin === "declared");
assert.ok(declared.some((rel) => rel.fromTable === "Order" && rel.toTable === "Customer"));
assert.ok(declared.some((rel) => rel.fromTable === "OrderItem" && rel.toTable === "Product"));
assert.ok(
  declared.find((rel) => rel.fromTable === "Payment" && rel.toTable === "Order")?.kind ===
    "one-to-one",
);
assert.ok(
  !parsed.relations.some(
    (rel) => rel.origin === "implicit" && rel.fromTable === "Customer" && rel.toTable === "Order",
  ),
);

const guide = buildGuideFromFiles(files);
assert.equal(guide.tables.length, 5);
assert.equal(guide.database.kind, "relational");
assert.equal(guide.database.providerLabel, "PostgreSQL");
assert.match(guide.database.summary, /relational/i);
assert.equal(guide.stats.tables, 5);
assert.ok(guide.stats.primaryKeys >= 5);
assert.ok(guide.stats.foreignKeys >= 3);
assert.ok(guide.schemaSource?.content.includes("model Order"));
assert.match(guide.overview, /customer|product|order/i);
const order = guide.tables.find((table) => table.id === "Order");
assert.ok(order);
assert.equal(order.purposeOrigin, "schema");
assert.ok(order.usages.some((use) => use.callee === "order.create"));
assert.ok(order.usages.some((use) => use.functionName === "createOrder"));
const items = guide.tables.find((table) => table.id === "OrderItem");
assert.ok(items?.usages.some((use) => use.callee === "items.create"));
const payment = guide.tables.find((table) => table.id === "Payment");
assert.ok(payment?.usages.some((use) => use.callee === "payment.create"));
assert.ok(guide.actions.some((action) => /checks out/i.test(action.question)));
assert.ok(guide.concepts.some((concept) => concept.id === "billing"));

const story = buildOverviewStory(guide);
assert.match(story.headline, /customers|orders|products/i);
assert.ok(!/primary key|foreign key|one-to-many/i.test(story.headline));
assert.match(story.how, /spreadsheet/i);
assert.equal(story.heroes.length, 3);
assert.ok(story.connections.some((line) => /one customer can have many orders/i.test(line)));
assert.ok(story.groups.some((group) => group.id === "accounts" || group.id === "work"));

const explore = buildExploreStory(guide, "Customer");
assert.match(explore.headline, /person|customer/i);
assert.ok(explore.heroes.length === 3);
assert.ok(explore.connections.some((line) => /one customer can have many orders/i.test(line)));
assert.ok(!/0\.\.N|primary key|foreign key/i.test(explore.headline));

const asked = heuristicAsk("What happens when someone signs up?", guide);
assert.match(asked.answer, /people|customer|person/i);
assert.ok(!/findUnique|prisma\.|primary key|foreign key/i.test(asked.answer));
assert.ok(
  asked.walkthrough.every((step) => !/\(\)|findUnique|schema\.prisma/i.test(step.text)),
);
assert.ok(asked.graph.nodes.some((node) => node.tableId === "Customer"));
assert.ok(!asked.graph.nodes.some((node) => node.tableId === "Payment"));

const knowledge = buildKnowledgeGraph(guide);
assert.ok(knowledge.nodes.some((node) => node.id === "list:Customer"));
assert.ok(knowledge.edges.some((edge) => edge.kind === "has-many"));
assert.ok(!knowledge.nodes.some((node) => node.kind === "setting"));

const restrict = heuristicAsk("how can I restrict a user", guide);
assert.match(restrict.answer, /no way to restrict|no role or permission/i);
assert.ok(!/this is about people and firms/i.test(restrict.answer));
assert.ok(restrict.walkthrough.length <= 4);
assert.ok(restrict.tableIds.length <= 2);
assert.ok(!restrict.graph.nodes.some((node) => node.kind === "setting"));
assert.ok(!restrict.graph.edges.some((edge) => edge.kind === "controls"));
assert.ok(!restrict.graph.nodes.some((node) => node.tableId === "Product"));
assert.ok(!restrict.graph.nodes.some((node) => node.tableId === "Payment"));

const restrictSlice = queryKnowledgeGraph("how can I restrict a user", guide);
assert.ok(restrictSlice.nodes.some((node) => node.tableId === "Customer"));
assert.ok(restrictSlice.nodes.length <= 8);

const shopReset = heuristicAsk("how do i reset password", guide);
assert.match(shopReset.answer, /no way to reset|no password/i);
assert.ok(!/stores firm|stores each purchase/i.test(shopReset.answer));
assert.ok(!shopReset.graph.nodes.some((node) => node.tableId === "Firm"));
assert.ok(!shopReset.graph.nodes.some((node) => /order|product|payment/i.test(node.tableId ?? "")));

const firmFiles = [
  {
    path: "prisma/schema.prisma",
    content: `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
model User {
  id String @id
  memberships Membership[]
}
model Firm {
  id String @id
  memberships Membership[]
}
model Membership {
  id String @id
  userId String
  firmId String
  role String
  user User @relation(fields: [userId], references: [id])
  firm Firm @relation(fields: [firmId], references: [id])
}
`,
  },
];
const firm = buildGuideFromFiles(firmFiles);
const firmRestrict = heuristicAsk("how can I restrict a user", firm);
assert.match(firmRestrict.answer, /membership|role/i);
assert.ok(
  firmRestrict.graph.nodes.some((node) => node.kind === "setting") ||
    firmRestrict.graph.edges.some((edge) => edge.kind === "controls"),
);
assert.ok(!/proposal|audit|this is about people and firms/i.test(firmRestrict.answer));

const legalResetGuide = buildGuideFromFiles([
  {
    path: "prisma/schema.prisma",
    content: `datasource db { provider = "postgresql" url = env("DATABASE_URL") }
model Firm { id String @id users User[] clients Client[] matters Matter[] }
model User { id String @id firmId String firm Firm @relation(fields: [firmId], references: [id]) }
model Client { id String @id firmId String firm Firm @relation(fields: [firmId], references: [id]) }
model Matter { id String @id firmId String firm Firm @relation(fields: [firmId], references: [id]) }
model Document { id String @id matterId String matter Matter @relation(fields: [matterId], references: [id]) }
`,
  },
]);
const legalReset = heuristicAsk("how do i reset password", legalResetGuide);
assert.match(legalReset.answer, /no way to reset|no password|reset token/i);
assert.ok(!/stores firm records/i.test(legalReset.answer));
assert.ok(!legalReset.graph.nodes.some((node) => node.tableId === "Firm"));
assert.ok(!legalReset.graph.nodes.some((node) => node.tableId === "Client"));
assert.ok(!legalReset.graph.nodes.some((node) => node.tableId === "Matter"));
assert.ok(legalReset.walkthrough.every((step) => !/firm can have many/i.test(step.text)));

const backend = buildBackendStories(guide);
assert.ok(backend.simulated);
assert.ok(backend.features.some((item) => item.id === "checkout"));
assert.ok(backend.features.some((item) => item.id === "signup"));
assert.ok(backend.features.some((item) => item.id === "browse"));
assert.ok(backend.features.some((item) => item.id === "track"));
assert.match(backend.blurb, /simulated/i);
assert.ok(!/live trace/i.test(backend.headline));
const checkout = backend.features.find((item) => item.id === "checkout");
assert.ok(checkout);
assert.ok(checkout.steps.some((step) => step.kind === "decision"));
assert.ok(checkout.steps.some((step) => step.kind === "database"));
assert.ok(checkout.steps.some((step) => step.kind === "service"));
assert.ok(checkout.scenarios.some((item) => item.id === "failure"));
const happy = scenarioPath(checkout, "success");
const declined = scenarioPath(checkout, "failure");
assert.ok(happy.includes("checkout-save"));
assert.ok(!declined.includes("checkout-save"));
assert.ok(declined.includes("checkout-fail"));
const save = checkout.steps.find((step) => step.id === "checkout-save");
assert.match(save?.sample.happen ?? "", /order/i);
assert.ok(save?.tech?.functionName === "createOrder");
assert.ok(save?.fields.some((field) => field.field === "customerId"));

const indie = buildGuideFromFiles([
  {
    path: "prisma/schema.prisma",
    content: `datasource db { provider = "sqlite" url = env("DATABASE_URL") }
model User { id String @id notes Note[] passwords Password[] }
model Password { id String @id userId String user User @relation(fields: [userId], references: [id]) }
model Note { id String @id userId String user User @relation(fields: [userId], references: [id]) }
`,
  },
]);
assert.ok(indie.backend?.features.some((item) => item.id === "signup"));
assert.ok(indie.backend?.features.some((item) => item.id === "write-note"));
assert.ok(!indie.backend?.features.some((item) => item.id === "checkout"));

const legal = buildGuideFromFiles([
  {
    path: "prisma/schema.prisma",
    content: `datasource db { provider = "postgresql" url = env("DATABASE_URL") }
model User { id String @id email String firmId String firm Firm @relation(fields: [firmId], references: [id]) passwords Password[] }
model Password { id String @id userId String user User @relation(fields: [userId], references: [id]) }
model Firm { id String @id name String users User[] clients Client[] matters Matter[] }
model Client { id String @id name String firmId String firm Firm @relation(fields: [firmId], references: [id]) matters Matter[] }
model Matter { id String @id title String firmId String clientId String firm Firm @relation(fields: [firmId], references: [id]) client Client @relation(fields: [clientId], references: [id]) documents Document[] }
model Document { id String @id filename String matterId String matter Matter @relation(fields: [matterId], references: [id]) chunks DocumentChunk[] }
model DocumentChunk { id String @id documentId String document Document @relation(fields: [documentId], references: [id]) }
`,
  },
]);
assert.ok(legal.tables.some((table) => table.id === "Matter"));
assert.ok(legal.tables.some((table) => table.id === "Document"));
assert.ok(!legal.backend?.features.some((item) => item.id === "checkout"));

const passwordReset = heuristicAsk("how do i reset password", indie);
assert.match(passwordReset.answer, /password/i);
assert.ok(passwordReset.graph.nodes.some((node) => node.tableId === "Password"));
assert.ok(!passwordReset.graph.nodes.some((node) => node.tableId === "Note"));

const checkoutAsk = heuristicBackendAsk("What happens when someone checks out?", guide);
assert.equal(checkoutAsk.featureId, "checkout");
assert.match(checkoutAsk.answer, /checkout|order|purchase/i);
assert.ok(checkoutAsk.walkthrough.length >= 2);
assert.ok(checkoutAsk.walkthrough.length <= 4);
assert.ok(!/prisma|foreign key|schema/i.test(checkoutAsk.answer));

const backendMiss = heuristicBackendAsk("what color is the logo", guide);
assert.equal(backendMiss.featureId, null);
assert.match(backendMiss.answer, /sign up|browse|checkout|track/i);

const backendRestrict = heuristicBackendAsk("how can I restrict a user", guide);
assert.match(backendRestrict.answer, /none of these backend stories restrict/i);

const django = buildGuideFromFiles([
  {
    path: "app/models.py",
    content: `from django.db import models
class Firm(models.Model):
    name = models.CharField(max_length=120)
class Matter(models.Model):
    title = models.CharField(max_length=200)
    firm = models.ForeignKey(Firm, on_delete=models.CASCADE)
`,
  },
]);
assert.ok(django.tables.some((table) => table.id === "Matter"));
assert.ok(django.tables.some((table) => table.id === "Firm"));
assert.ok(django.relations.some((rel) => rel.fromTable === "Matter" && rel.toTable === "Firm"));
assert.match(django.warnings.join(" "), /Django|No Prisma/i);

const drizzle = buildGuideFromFiles([
  {
    path: "src/db/schema.ts",
    content: `import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
});
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  body: text("body"),
});
`,
  },
]);
assert.ok(drizzle.tables.some((table) => table.id === "User"));
assert.ok(drizzle.tables.some((table) => table.id === "Note"));

const noSchema = buildGuideFromFiles([
  {
    path: "app/login/page.tsx",
    content: "export default function Login(){return <button>Log in</button>}",
  },
]);
assert.equal(noSchema.tables.length, 0);
assert.doesNotMatch(noSchema.database.summary, /Prisma schema \(schema\.prisma\)/);

const youi = buildGuideFromFiles([
  {
    path: "supabase/schema.sql",
    content: `create table public.users (id uuid primary key);
create table public.design_dnas (
  id uuid primary key,
  user_id uuid references public.users(id),
  moodboard_title text not null
);`,
  },
]);
assert.ok(youi.tables.some((table) => /design.?dna/i.test(table.id) || /design.?dna/i.test(table.tableName)));
assert.ok(youi.tables.some((table) => /user/i.test(table.id)));

console.log("schema-guide smoke checks passed");
