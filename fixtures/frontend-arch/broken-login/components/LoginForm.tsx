"use client";

export function LoginForm() {
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Confirmed gap: never calls the auth API
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" placeholder="Email" type="text" />
      <img src="/hero.png" />
      <button type="submit" onClick={() => {}}>
        Sign in
      </button>
    </form>
  );
}
