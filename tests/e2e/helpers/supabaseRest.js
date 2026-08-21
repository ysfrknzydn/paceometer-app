// The public, non-secret project URL/anon key -- duplicated from
// js/supabaseClient.js rather than imported, since that file is loaded by
// the browser via an esm.sh https:// specifier that this Node-side test
// code can't import directly. RLS policies are what actually gate access
// via the anon key, not the key's secrecy -- see that file's own comment.
export const SUPABASE_URL = "https://ojhhlxmbawckknnpgmfj.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaGhseG1iYXdja2tubnBnbWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzAzMzIsImV4cCI6MjA5OTQ0NjMzMn0.PEI5_IU-V-UUEtO_mmSZt-iacbps-OoKiw-SxW4mLOY";
