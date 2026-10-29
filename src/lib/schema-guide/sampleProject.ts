import type { UploadedFile } from "@/lib/schema-guide/types";

export const SAMPLE_SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  CANCELLED
}

model Customer {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  createdAt DateTime @default(now())
  orders    Order[]
}

model Product {
  id        String      @id @default(cuid())
  sku       String      @unique
  name      String
  price     Int
  createdAt DateTime    @default(now())
  items     OrderItem[]
}

/// Stores each purchase a customer makes.
model Order {
  id         String      @id @default(cuid())
  customerId String
  status     OrderStatus @default(PENDING)
  total      Int
  createdAt  DateTime    @default(now())
  customer   Customer    @relation(fields: [customerId], references: [id])
  items      OrderItem[]
  payment    Payment?
}

model OrderItem {
  id        String  @id @default(cuid())
  orderId   String
  productId String
  quantity  Int
  unitPrice Int
  order     Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product   Product @relation(fields: [productId], references: [id])
}

model Payment {
  id        String   @id @default(cuid())
  orderId   String   @unique
  amount    Int
  status    String
  createdAt DateTime @default(now())
  order     Order    @relation(fields: [orderId], references: [id])
}
`;

export const SAMPLE_CHECKOUT = `import { prisma } from "./db";

export async function createOrder(
  customerId: string,
  items: Array<{ productId: string; quantity: number; unitPrice: number }>,
) {
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return prisma.order.create({
    data: {
      customerId,
      status: "PENDING",
      total,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    },
  });
}

export async function markOrderPaid(orderId: string, amount: number) {
  await prisma.payment.create({
    data: { orderId, amount, status: "PAID" },
  });
  return prisma.order.update({
    where: { id: orderId },
    data: { status: "PAID" },
  });
}
`;

export const SAMPLE_CATALOG = `import { prisma } from "./db";

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { name: "asc" } });
}

export async function findCustomerByEmail(email: string) {
  return prisma.customer.findUnique({ where: { email } });
}
`;

export const SAMPLE_PRODUCT_CARD = `export function ProductCard({ product, onAddToCart }) {
  return (
    <article>
      <h2>{product.name}</h2>
      <p>\${product.price}</p>
      <button onClick={() => onAddToCart(product)}>Add to cart</button>
    </article>
  );
}

export function handleAddToCart(product) {
  return fetch("/api/cart", {
    method: "POST",
    body: JSON.stringify({ productId: product.id }),
  });
}

export function CartBadge({ count }) {
  return <span>{count}</span>;
}

export function CheckoutTotal({ products, shipping }) {
  const total = products + shipping;
  return <p>\${total} total</p>;
}

export function placeOrder() {
  return fetch("/api/orders", { method: "POST" });
}
`;

export function sampleProjectFiles(): UploadedFile[] {
  return [
    { path: "prisma/schema.prisma", content: SAMPLE_SCHEMA },
    { path: "src/checkout.ts", content: SAMPLE_CHECKOUT },
    { path: "src/catalog.ts", content: SAMPLE_CATALOG },
    { path: "src/ProductCard.tsx", content: SAMPLE_PRODUCT_CARD },
  ];
}
