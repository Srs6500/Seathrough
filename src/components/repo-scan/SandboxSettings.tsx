"use client";

import { Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import {
  EMPTY_SANDBOX,
  readStoredSandbox,
  writeStoredSandbox,
  type RepoScanSandboxInput,
} from "@/lib/repo-scan/sandbox";

export function SandboxSettings({
  disabled,
  scanLabel,
  onScan,
}: {
  disabled?: boolean;
  scanLabel?: string;
  onScan: (sandbox: RepoScanSandboxInput) => void;
}) {
  const [sandbox, setSandbox] = useState<RepoScanSandboxInput>(EMPTY_SANDBOX);

  useEffect(() => {
    setSandbox(readStoredSandbox());
  }, []);

  function update<K extends keyof RepoScanSandboxInput>(
    key: K,
    value: RepoScanSandboxInput[K],
  ) {
    setSandbox((current) => {
      const next = { ...current, [key]: value };
      writeStoredSandbox(next);
      return next;
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const next = {
          ...sandbox,
          baseUrl: sandbox.baseUrl.trim(),
          apiUrl: sandbox.apiUrl.trim(),
          user: sandbox.user.trim(),
        };
        writeStoredSandbox(next);
        onScan(next);
      }}
    >
      <Stack gap="sm">
        <div>
          <Text fw={600} size="sm">
            Where is the running app?
          </Text>
          <Text size="sm" c="dimmed" mt={4}>
            SeeThrough will open these URLs in a browser. Not this site.
          </Text>
        </div>
        <TextInput
          label="App URL"
          description="The frontend, like http://127.0.0.1:5173"
          placeholder="http://127.0.0.1:5173"
          value={sandbox.baseUrl}
          onChange={(event) => update("baseUrl", event.currentTarget.value)}
          disabled={disabled}
          required
          autoComplete="off"
        />
        <TextInput
          label="API URL"
          description="The backend, like http://127.0.0.1:8000"
          placeholder="http://127.0.0.1:8000"
          value={sandbox.apiUrl}
          onChange={(event) => update("apiUrl", event.currentTarget.value)}
          disabled={disabled}
          autoComplete="off"
        />
        <TextInput
          label="Test login"
          description="A user that can sign in to that app"
          placeholder="email or username"
          value={sandbox.user}
          onChange={(event) => update("user", event.currentTarget.value)}
          disabled={disabled}
          autoComplete="username"
        />
        <PasswordInput
          label="Password"
          placeholder="password for that login"
          value={sandbox.password}
          onChange={(event) => update("password", event.currentTarget.value)}
          disabled={disabled}
          autoComplete="current-password"
        />
        <Button type="submit" disabled={disabled}>
          {scanLabel || "Scan"}
        </Button>
      </Stack>
    </form>
  );
}
