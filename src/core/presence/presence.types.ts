export type PresenceRecord = {
  provider: string;
  session: string;
  pid: number;
  branch: string;
  started_at: string;
  heartbeat_at: string;
  recent_files: string[];
};
