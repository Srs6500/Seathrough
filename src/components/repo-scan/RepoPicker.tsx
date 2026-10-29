"use client";

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { FolderGit2, RefreshCw, Search } from "lucide-react";
import { motion } from "motion/react";
import type { RepoWithStack } from "@/lib/bug-analyzer/client";

const PAGE_SIZE = 12;

export function RepoPicker({
  query,
  onQuery,
  repoFilter,
  onFilter,
  loading,
  listError,
  repos,
  onRefresh,
  onOpen,
  searchRef,
}: {
  query: string;
  onQuery: (value: string) => void;
  repoFilter: "all" | "public" | "private";
  onFilter: (value: "all" | "public" | "private") => void;
  loading: boolean;
  listError: string | null;
  repos: RepoWithStack[];
  onRefresh: () => void;
  onOpen: (repo: RepoWithStack) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [page, setPage] = useState(1);
  const reduce = useReducedMotion();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos.filter((repo) => {
      if (repoFilter === "public" && repo.private) return false;
      if (repoFilter === "private" && !repo.private) return false;
      if (!q) return true;
      return (
        repo.fullName.toLowerCase().includes(q) ||
        repo.name.toLowerCase().includes(q) ||
        repo.stackLabel.toLowerCase().includes(q)
      );
    });
  }, [repos, query, repoFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <Stack gap="md" maw={960} mx="auto" p="lg" w="100%">
      <div>
        <Title order={2}>Pick a repo</Title>
        <Text c="dimmed" size="sm" mt={4}>
          We'll check which parts actually work.
        </Text>
      </div>
      <TextInput
        ref={searchRef}
        value={query}
        onChange={(event) => {
          onQuery(event.currentTarget.value);
          setPage(1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && paged[0]) onOpen(paged[0]);
        }}
        placeholder="Search repositories…"
        leftSection={<Search className="size-4" aria-hidden />}
        rightSection={loading ? <Loader size="xs" /> : null}
        aria-label="Search repositories"
      />
      <Group justify="space-between">
        <SegmentedControl
          value={repoFilter}
          onChange={(value) => {
            onFilter(value as "all" | "public" | "private");
            setPage(1);
          }}
          data={[
            { label: "All", value: "all" },
            { label: "Public", value: "public" },
            { label: "Private", value: "private" },
          ]}
        />
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {loading ? "Loading…" : `${filtered.length} repos`}
          </Text>
          <ActionIcon
            variant="subtle"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh repositories"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </ActionIcon>
        </Group>
      </Group>
      {listError ? (
        <Text c="red" size="sm" role="alert">
          {listError}
        </Text>
      ) : null}
      {loading && repos.length === 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} withBorder padding="md" radius="md">
              <Skeleton height={16} width="50%" mb="sm" />
              <Skeleton height={12} width="80%" />
            </Card>
          ))}
        </SimpleGrid>
      ) : paged.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Text ta="center" fw={500}>
            {query.trim() || repoFilter !== "all"
              ? "No repositories match"
              : "No repositories available"}
          </Text>
          <Text ta="center" size="sm" c="dimmed" mt={6}>
            {query.trim() || repoFilter !== "all"
              ? "Try another search or filter."
              : "Install the GitHub App on the repos you want to scan."}
          </Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          {paged.map((repo) => (
            <motion.div
              key={repo.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <UnstyledButton w="100%" onClick={() => onOpen(repo)}>
                <Card withBorder padding="md" radius="md" h="100%">
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <FolderGit2
                      className="mt-0.5 size-4 shrink-0 text-[#2a5f7a]"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <Text fw={600} size="sm" truncate>
                        {repo.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate mt={2}>
                        {repo.fullName}
                      </Text>
                      <Group gap={6} mt={8}>
                        <Badge variant="light" size="sm">
                          {repo.stackLabel}
                        </Badge>
                        <Badge
                          variant="light"
                          size="sm"
                          color={repo.private ? "gray" : "teal"}
                        >
                          {repo.private ? "Private" : "Public"}
                        </Badge>
                      </Group>
                    </div>
                  </Group>
                </Card>
              </UnstyledButton>
            </motion.div>
          ))}
        </SimpleGrid>
      )}
      {pageCount > 1 ? (
        <Pagination
          total={pageCount}
          value={safePage}
          onChange={setPage}
          mx="auto"
        />
      ) : null}
    </Stack>
  );
}
