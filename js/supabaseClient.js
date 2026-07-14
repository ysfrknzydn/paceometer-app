import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

// The anon key is safe to commit -- it identifies the app, not a secret.
// Row Level Security policies (see supabase/migrations/) are what actually
// gate access, not this key.
const SUPABASE_URL = "https://ojhhlxmbawckknnpgmfj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaGhseG1iYXdja2tubnBnbWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzAzMzIsImV4cCI6MjA5OTQ0NjMzMn0.PEI5_IU-V-UUEtO_mmSZt-iacbps-OoKiw-SxW4mLOY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
