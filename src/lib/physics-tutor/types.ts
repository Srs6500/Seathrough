export type PhysicsChunkSource = "schnick" | "crowell" | "seed" | "vfpt";

export type PhysicsChunk = {
  id: string;
  source: PhysicsChunkSource;
  title: string;
  topic: string;
  text: string;
  /** Optional local diagram filename under Physics-tutor-data/vfpt-svgs */
  diagram?: string;
};

export type PhysicsRetrievalHit = PhysicsChunk & {
  score: number;
};

export type PhysicsTutorContext = {
  pedagogyRules: string;
  chunks: PhysicsRetrievalHit[];
  diagrams: Array<{ filename: string; label: string; topics: string[] }>;
};
