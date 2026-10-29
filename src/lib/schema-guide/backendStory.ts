import { humanLabel } from "@/lib/schema-guide/overviewStory";
import type {
  BackendFeature,
  BackendFieldLink,
  BackendGuide,
  BackendScenario,
  BackendScenarioId,
  BackendStep,
  BackendStepKind,
  BackendTech,
  CodeOperation,
  CodeUsage,
  SchemaGuide,
  TableGuide,
} from "@/lib/schema-guide/types";

function words(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

function tableNamed(guide: SchemaGuide, match: RegExp): TableGuide | undefined {
  return guide.tables.find((table) => match.test(table.id));
}

function usageOf(
  table: TableGuide | undefined,
  ops?: CodeOperation[],
): CodeUsage | undefined {
  if (!table) return undefined;
  if (!ops) return table.usages[0];
  return table.usages.find((use) => ops.includes(use.operation));
}

function methodFor(op: CodeOperation | undefined): string | null {
  if (!op) return null;
  if (op === "create" || op === "upsert") return "POST";
  if (op === "update") return "PATCH";
  if (op === "delete") return "DELETE";
  if (op === "read" || op === "count") return "GET";
  return null;
}

function kebab(name: string): string {
  return words(name).replace(/\s+/g, "-");
}

function routeFor(use: CodeUsage | undefined, table?: TableGuide): string | null {
  const file = use?.file ?? "";
  const appApi = file.match(/(?:^|\/)app\/api\/(.+)\/route\.[jt]sx?$/i);
  if (appApi?.[1]) return `/api/${appApi[1]}`;
  const pagesApi = file.match(/(?:^|\/)(?:src\/)?pages\/api\/(.+)\.[jt]sx?$/i);
  if (pagesApi?.[1]) return `/api/${pagesApi[1]}`;
  const fn = use?.functionName ?? "";
  const rest = fn.replace(
    /^(create|list|get|find|update|delete|mark|save|load)/i,
    "",
  );
  if (rest && rest.length > 2) {
    const slug = kebab(rest).replace(/-by-.*$/, "");
    return `/api/${slug.replace(/s$/, "")}s`.replace(/ss$/, "s");
  }
  if (table) return `/api/${kebab(table.tableName || table.id)}s`.replace(/ss$/, "s");
  return null;
}

function techFrom(
  use: CodeUsage | undefined,
  table?: TableGuide,
): BackendTech | null {
  if (!use && !table) return null;
  return {
    method: methodFor(use?.operation),
    route: routeFor(use, table),
    functionName: use?.functionName ?? null,
    file: use?.file ?? null,
    line: use?.line ?? null,
    callee: use?.callee ?? null,
    snippet: use?.snippet ?? null,
    tableId: use?.tableId ?? table?.id ?? null,
  };
}

function fkField(guide: SchemaGuide, fromId: string, toId: string): string | null {
  const rel = guide.relations.find(
    (item) =>
      item.origin === "declared" &&
      item.fromTable === fromId &&
      item.toTable === toId,
  );
  return rel?.fromField ?? null;
}

function fieldLink(
  guide: SchemaGuide,
  fromId: string,
  toId: string,
): BackendFieldLink | null {
  const field = fkField(guide, fromId, toId);
  if (!field) return null;
  return { human: humanLabel(toId).replace(/s$/, ""), field };
}

function paymentBrand(guide: SchemaGuide): string {
  const hay = guide.tables
    .flatMap((table) => table.usages)
    .map((use) => `${use.file} ${use.snippet} ${use.functionName ?? ""}`)
    .join(" ");
  if (/stripe/i.test(hay)) return "Stripe";
  if (/paypal/i.test(hay)) return "PayPal";
  if (/square/i.test(hay)) return "Square";
  return "the payment service";
}

function step(input: {
  id: string;
  kind: BackendStepKind;
  label: string;
  summary: string;
  sample: BackendStep["sample"];
  tech?: BackendTech | null;
  fields?: BackendFieldLink[];
  next?: string | null;
  yesTo?: string | null;
  noTo?: string | null;
}): BackendStep {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    summary: input.summary,
    sample: input.sample,
    tech: input.tech ?? null,
    fields: input.fields ?? [],
    next: input.next ?? null,
    yesTo: input.yesTo ?? null,
    noTo: input.noTo ?? null,
  };
}

function feature(input: Omit<BackendFeature, "scenarios"> & {
  scenarios?: BackendScenario[];
}): BackendFeature {
  return {
    ...input,
    scenarios: input.scenarios ?? [
      {
        id: "success",
        label: "Happy path",
        outcome: "The request finishes.",
      },
    ],
  };
}

export function scenarioPath(
  feature: BackendFeature,
  scenario: BackendScenarioId,
): string[] {
  const byId = new Map(feature.steps.map((item) => [item.id, item]));
  const ids: string[] = [];
  let current = feature.startId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    ids.push(current);
    const item = byId.get(current);
    if (!item) break;
    const next =
      item.kind === "decision"
        ? scenario === "failure"
          ? item.noTo
          : item.yesTo
        : item.next;
    if (!next) break;
    current = next;
  }
  return ids;
}

function signupFeature(guide: SchemaGuide): BackendFeature | null {
  const person = tableNamed(guide, /^(user|customer)$/i);
  if (!person) return null;
  const secret = tableNamed(guide, /^(password|session|token)$/i);
  const lookup = usageOf(person, ["read", "create"]);
  const write = usageOf(person, ["create", "upsert"]);
  const secretWrite = usageOf(secret, ["create", "upsert"]);
  const people = humanLabel(person.tableName || person.id).toLowerCase();
  return feature({
    id: "signup",
    title: "Sign up",
    when: "When someone creates an account",
    summary: `The app stores a new person in ${people}.`,
    tableIds: [person.id, secret?.id].filter(Boolean) as string[],
    startId: "signup-start",
    steps: [
      step({
        id: "signup-start",
        kind: "action",
        label: "Someone fills in their details",
        summary: "They type a name and email so the app can remember them.",
        sample: {
          enter: "A new visitor",
          happen: "They submit name and email",
          leave: "The app has a sign-up request",
        },
        next: "signup-check",
      }),
      step({
        id: "signup-check",
        kind: "action",
        label: "Check the email is new",
        summary: "Look in the people list so two accounts do not share one email.",
        sample: {
          enter: "email: ada@example.com",
          happen: "Search the people list",
          leave: "This email is free",
        },
        tech: techFrom(lookup, person),
        next: "signup-save",
      }),
      step({
        id: "signup-save",
        kind: "database",
        label: "Save the person",
        summary: `Creates a ${words(person.tableName || person.id)} record.`,
        sample: {
          enter: "Name and email",
          happen: `Add a row to ${people}`,
          leave: `${humanLabel(person.id).replace(/s$/, "")} id is ready`,
        },
        tech: techFrom(write, person),
        next: secret ? "signup-secret" : "signup-done",
      }),
      ...(secret
        ? [
            step({
              id: "signup-secret",
              kind: "database",
              label: `Save the ${words(secret.tableName || secret.id)}`,
              summary: `Keeps the secret linked to this ${words(person.id)}.`,
              sample: {
                enter: "The new person id",
                happen: `Store the ${words(secret.id)}`,
                leave: "They can sign in later",
              },
              tech: techFrom(secretWrite, secret),
              fields: [fieldLink(guide, secret.id, person.id)].filter(
                Boolean,
              ) as BackendFieldLink[],
              next: "signup-done",
            }),
          ]
        : []),
      step({
        id: "signup-done",
        kind: "action",
        label: "They're in",
        summary: "The app can now treat them as a known person.",
        sample: {
          enter: "Saved person",
          happen: "Open the signed-in home",
          leave: "A new account exists",
        },
      }),
    ],
  });
}

function loginFeature(guide: SchemaGuide): BackendFeature | null {
  const person = tableNamed(guide, /^(user|customer)$/i);
  const secret = tableNamed(guide, /^(password|session|token)$/i);
  if (!person) return null;
  if (
    !secret &&
    !usageOf(person, ["read"]) &&
    !person.fields.some((field) => /password|secret|hash/i.test(field.name))
  ) {
    return null;
  }
  const lookup = usageOf(person, ["read"]) ?? usageOf(person);
  const secretRead = usageOf(secret, ["read", "create"]);
  return feature({
    id: "login",
    title: "Log in",
    when: "When someone comes back",
    summary: "The app looks up the person and checks they are allowed in.",
    tableIds: [person.id, secret?.id].filter(Boolean) as string[],
    startId: "login-start",
    scenarios: [
      {
        id: "success",
        label: "Password matches",
        outcome: "They are signed in.",
      },
      {
        id: "failure",
        label: "Wrong password",
        outcome: "They stay signed out.",
      },
    ],
    steps: [
      step({
        id: "login-start",
        kind: "action",
        label: "Someone types email and password",
        summary: "They ask the app to recognize them.",
        sample: {
          enter: "ada@example.com",
          happen: "Submit the log-in form",
          leave: "A log-in request starts",
        },
        next: "login-lookup",
      }),
      step({
        id: "login-lookup",
        kind: "database",
        label: "Look up the person",
        summary: `Find this email in ${humanLabel(person.tableName || person.id).toLowerCase()}.`,
        sample: {
          enter: "email: ada@example.com",
          happen: "Read that row",
          leave: "The person exists",
        },
        tech: techFrom(lookup, person),
        next: "login-check",
      }),
      step({
        id: "login-check",
        kind: "decision",
        label: secret ? "Does the password match?" : "Do we know this person?",
        summary: secret
          ? "Compare what they typed with the stored secret."
          : "Only a known email can sign in.",
        sample: {
          enter: "Typed secret",
          happen: "Compare with the saved one",
          leave: "Match or no match",
        },
        tech: techFrom(secretRead, secret),
        yesTo: "login-ok",
        noTo: "login-fail",
      }),
      step({
        id: "login-ok",
        kind: "action",
        label: "Keep them signed in",
        summary: "The app remembers this visit.",
        sample: {
          enter: "A matching person",
          happen: "Start a session",
          leave: "They see the signed-in app",
        },
      }),
      step({
        id: "login-fail",
        kind: "action",
        label: "Show a sign-in error",
        summary: "Nothing is changed. They can try again.",
        sample: {
          enter: "No match",
          happen: "Stop the request",
          leave: "“That email or password is wrong.”",
        },
      }),
    ],
  });
}

function browseFeature(guide: SchemaGuide): BackendFeature | null {
  const product = tableNamed(guide, /product|item|listing|catalog/i);
  if (!product || tableNamed(guide, /^orderitem$/i)?.id === product.id) {
    return null;
  }
  const read = usageOf(product, ["read", "count"]) ?? usageOf(product);
  const names = product.sampleRows
    .map((row) => row.values.name || row.values.sku)
    .filter(Boolean)
    .slice(0, 2);
  const shown = names.length ? names.join(" · ") : "A list of things for sale";
  return feature({
    id: "browse",
    title: "Browse products",
    when: "When someone looks at what they can buy",
    summary: `The app reads ${humanLabel(product.tableName || product.id).toLowerCase()} and shows them.`,
    tableIds: [product.id],
    startId: "browse-start",
    steps: [
      step({
        id: "browse-start",
        kind: "action",
        label: "Someone opens the catalog",
        summary: "They want to see what is for sale.",
        sample: {
          enter: "A visitor",
          happen: "Open the products page",
          leave: "Ask the backend for the list",
        },
        next: "browse-read",
      }),
      step({
        id: "browse-read",
        kind: "database",
        label: "Read the products",
        summary: "Load the rows the shop can show.",
        sample: {
          enter: "No filters",
          happen: "Read the products list",
          leave: shown,
        },
        tech: techFrom(read, product),
        next: "browse-show",
      }),
      step({
        id: "browse-show",
        kind: "action",
        label: "Show the list",
        summary: "The page renders those products.",
        sample: {
          enter: shown,
          happen: "Draw the cards",
          leave: "The visitor can pick one",
        },
      }),
    ],
  });
}

function checkoutFeature(guide: SchemaGuide): BackendFeature | null {
  const order = tableNamed(guide, /^order$/i);
  if (!order) return null;
  const items = tableNamed(guide, /^orderitem$/i);
  const payment = tableNamed(guide, /^payment$/i);
  const person = tableNamed(guide, /^(user|customer)$/i);
  const product = tableNamed(guide, /^product$/i);
  const create = usageOf(order, ["create", "upsert"]);
  const itemCreate = usageOf(items, ["create"]);
  const payCreate = usageOf(payment, ["create", "upsert"]);
  const brand = paymentBrand(guide);
  const fields = [
    person ? fieldLink(guide, order.id, person.id) : null,
    items && product ? fieldLink(guide, items.id, product.id) : null,
  ].filter(Boolean) as BackendFieldLink[];

  const steps: BackendStep[] = [
    step({
      id: "checkout-start",
      kind: "action",
      label: "Customer clicks Place order",
      summary: "Someone is ready to buy what is in the cart.",
      sample: {
        enter: "A signed-in customer",
        happen: "They press Place order",
        leave: "Checkout starts",
      },
      next: "checkout-cart",
    }),
    step({
      id: "checkout-cart",
      kind: "action",
      label: "Check login and cart",
      summary: "Make sure we know the buyer and that the items are still there.",
      sample: {
        enter: "Cart with 2 products",
        happen: "Confirm the person and stock",
        leave: "2 products · Both in stock",
      },
      tech: techFrom(usageOf(person, ["read"]), person),
      next: "checkout-total",
    }),
    step({
      id: "checkout-total",
      kind: "action",
      label: "Calculate total",
      summary: "Add up the products and any shipping.",
      sample: {
        enter: "2 products in the cart",
        happen: "Add prices and shipping",
        leave: "Products $40 + shipping $5 = $45",
      },
      tech: techFrom(create, order),
      next: payment ? "checkout-pay" : "checkout-save",
    }),
  ];

  if (payment) {
    steps.push(
      step({
        id: "checkout-pay",
        kind: "service",
        label: "Request payment",
        summary: `Ask ${brand} to collect the money. This is outside the app’s database.`,
        sample: {
          enter: "$45 due",
          happen: `Send $45 payment request to ${brand}`,
          leave: "Waiting for yes or no",
        },
        tech: techFrom(payCreate, payment),
        next: "checkout-decide",
      }),
      step({
        id: "checkout-decide",
        kind: "decision",
        label: "Payment successful?",
        summary: "Only a paid cart becomes an order.",
        sample: {
          enter: "Payment reply",
          happen: "Read success or declined",
          leave: "Yes continues · No stops",
        },
        yesTo: "checkout-save",
        noTo: "checkout-fail",
      }),
    );
  }

  steps.push(
    step({
      id: "checkout-save",
      kind: "database",
      label: "Save the order",
      summary: person
        ? `Creates a purchase record linked to this ${words(person.id)}.`
        : "Creates a purchase record and its line items.",
      sample: {
        enter: "$45 paid cart",
        happen: items
          ? "Create an order and 2 order items"
          : "Create an order",
        leave: "The purchase is stored",
      },
      tech: techFrom(create, order),
      fields,
      next: "checkout-done",
    }),
    step({
      id: "checkout-done",
      kind: "action",
      label: "Send confirmation",
      summary: "Tell the customer the order is in.",
      sample: {
        enter: "Saved order",
        happen: "Show a thank-you page",
        leave: "The customer has an order id",
      },
      tech: techFrom(itemCreate ?? create, items ?? order),
    }),
  );

  if (payment) {
    steps.push(
      step({
        id: "checkout-fail",
        kind: "action",
        label: "Show payment error",
        summary: "Nothing is written to the order list.",
        sample: {
          enter: "Payment declined",
          happen: "Stop before saving",
          leave: "“Payment did not go through.”",
        },
      }),
    );
  }

  return feature({
    id: "checkout",
    title: "Checkout",
    when: "When someone places an order",
    summary: payment
      ? "The app checks the cart, asks for payment, then saves the purchase."
      : "The app checks the cart and saves the purchase.",
    tableIds: [order.id, items?.id, payment?.id, person?.id].filter(
      Boolean,
    ) as string[],
    startId: "checkout-start",
    scenarios: payment
      ? [
          {
            id: "success",
            label: "Payment works",
            outcome: "The order and line items are saved.",
          },
          {
            id: "failure",
            label: "Payment declined",
            outcome: "No order is created.",
          },
        ]
      : undefined,
    steps,
  });
}

function trackFeature(guide: SchemaGuide): BackendFeature | null {
  const order = tableNamed(guide, /^order$/i);
  if (!order) return null;
  const read = usageOf(order, ["read"]) ?? usageOf(order);
  const statusField = order.fields.find((field) => /status/i.test(field.name));
  const status = order.sampleRows[0]?.values[statusField?.name ?? ""] || "PAID";
  return feature({
    id: "track",
    title: "Track an order",
    when: "When someone asks where their purchase is",
    summary: "The app reads that order and shows its status.",
    tableIds: [order.id],
    startId: "track-start",
    steps: [
      step({
        id: "track-start",
        kind: "action",
        label: "Someone opens an order",
        summary: "They want to know if it is packed or on the way.",
        sample: {
          enter: "An order id",
          happen: "Open the order page",
          leave: "Ask the backend for that row",
        },
        next: "track-read",
      }),
      step({
        id: "track-read",
        kind: "database",
        label: "Look up the order",
        summary: "Read the purchase and its status.",
        sample: {
          enter: "order id",
          happen: "Find that order",
          leave: statusField ? `${statusField.name}: ${status}` : "The order row",
        },
        tech: techFrom(read, order),
        fields: statusField
          ? [{ human: "Status", field: statusField.name }]
          : [],
        next: "track-show",
      }),
      step({
        id: "track-show",
        kind: "action",
        label: "Show where it is",
        summary: "The page repeats the stored status in everyday words.",
        sample: {
          enter: String(status),
          happen: "Translate it for the customer",
          leave: `This order is ${String(status).toLowerCase()}`,
        },
      }),
    ],
  });
}

function noteFeature(guide: SchemaGuide): BackendFeature | null {
  const note = tableNamed(guide, /^note$/i);
  if (!note) return null;
  const person = tableNamed(guide, /^(user|customer)$/i);
  const write = usageOf(note, ["create", "upsert", "update"]);
  return feature({
    id: "write-note",
    title: "Write a note",
    when: "When someone saves a note",
    summary: "The app stores the text and who wrote it.",
    tableIds: [note.id, person?.id].filter(Boolean) as string[],
    startId: "note-start",
    steps: [
      step({
        id: "note-start",
        kind: "action",
        label: "Someone writes a note",
        summary: "They type text they want to keep.",
        sample: {
          enter: "A signed-in person",
          happen: "Submit the note",
          leave: "A save request starts",
        },
        next: "note-save",
      }),
      step({
        id: "note-save",
        kind: "database",
        label: "Save the note",
        summary: person
          ? `Creates a note linked to this ${words(person.id)}.`
          : "Creates a note record.",
        sample: {
          enter: "Title and body",
          happen: "Add a notes row",
          leave: "The note has an id",
        },
        tech: techFrom(write, note),
        fields: person
          ? ([fieldLink(guide, note.id, person.id)].filter(
              Boolean,
            ) as BackendFieldLink[])
          : [],
        next: "note-show",
      }),
      step({
        id: "note-show",
        kind: "action",
        label: "Show it on their list",
        summary: "The new note appears with the others.",
        sample: {
          enter: "Saved note",
          happen: "Refresh the list",
          leave: "They can read it back",
        },
      }),
    ],
  });
}

function leftoverWrite(guide: SchemaGuide, covered: Set<string>): BackendFeature[] {
  const extras: BackendFeature[] = [];
  for (const table of guide.tables) {
    if (covered.has(table.id)) continue;
    if (/item|payment|password|session|token/i.test(table.id)) continue;
    const write = usageOf(table, ["create", "update", "upsert"]);
    if (!write) continue;
    const name = humanLabel(table.tableName || table.id);
    extras.push(
      feature({
        id: `save-${table.id}`,
        title: `Save ${name.toLowerCase()}`,
        when: `When the app stores ${name.toLowerCase()}`,
        summary: table.purpose,
        tableIds: [table.id],
        startId: `${table.id}-start`,
        steps: [
          step({
            id: `${table.id}-start`,
            kind: "action",
            label: `Someone asks to save ${name.toLowerCase()}`,
            summary: table.purpose,
            sample: {
              enter: "A form or request",
              happen: "Submit the change",
              leave: "The backend starts a write",
            },
            next: `${table.id}-save`,
          }),
          step({
            id: `${table.id}-save`,
            kind: "database",
            label: `Save ${name.toLowerCase()}`,
            summary: table.behavior || table.purpose,
            sample: {
              enter: "The new values",
              happen: `Write to ${name.toLowerCase()}`,
              leave: "The row is stored",
            },
            tech: techFrom(write, table),
            next: `${table.id}-done`,
          }),
          step({
            id: `${table.id}-done`,
            kind: "action",
            label: "Confirm it worked",
            summary: "The app shows the saved result.",
            sample: {
              enter: "Saved row",
              happen: "Return the new record",
              leave: "The screen updates",
            },
          }),
        ],
      }),
    );
    if (extras.length >= 3) break;
  }
  return extras;
}

export function buildBackendStories(guide: SchemaGuide): BackendGuide {
  const built = [
    signupFeature(guide),
    loginFeature(guide),
    browseFeature(guide),
    checkoutFeature(guide),
    trackFeature(guide),
    noteFeature(guide),
  ].filter(Boolean) as BackendFeature[];

  const covered = new Set(built.flatMap((item) => item.tableIds));
  built.push(...leftoverWrite(guide, covered));

  if (built.length === 0 && guide.tables[0]) {
    const table = guide.tables[0];
    built.push(
      feature({
        id: "look",
        title: `Look at ${humanLabel(table.tableName || table.id).toLowerCase()}`,
        when: "When someone opens the app",
        summary: table.purpose,
        tableIds: [table.id],
        startId: "look-start",
        steps: [
          step({
            id: "look-start",
            kind: "action",
            label: "Someone opens a screen",
            summary: table.purpose,
            sample: {
              enter: "A visitor",
              happen: "Ask for data",
              leave: "A read starts",
            },
            next: "look-read",
          }),
          step({
            id: "look-read",
            kind: "database",
            label: `Read ${humanLabel(table.tableName || table.id).toLowerCase()}`,
            summary: table.purpose,
            sample: {
              enter: "A list request",
              happen: "Read the rows",
              leave: "The page has data",
            },
            tech: techFrom(usageOf(table), table),
          }),
        ],
      }),
    );
  }

  const shoppy = built.some((item) => item.id === "checkout");
  return {
    headline: shoppy ? "What a customer can do" : "What people can do in this app",
    blurb:
      "Pick one thing. Then watch a sample request travel through the backend. This is a simulated walk-through, not a live trace.",
    simulated: true,
    features: built.slice(0, 8),
  };
}

export function guideBackend(guide: SchemaGuide): BackendGuide {
  if (guide.backend?.features?.length) return guide.backend;
  return buildBackendStories(guide);
}
