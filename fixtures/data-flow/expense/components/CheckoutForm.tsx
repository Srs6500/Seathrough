"use client";

export function CheckoutForm() {
  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ total: 42 }),
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <input name="card" placeholder="Card number" />
      <button type="submit">Pay</button>
    </form>
  );
}
