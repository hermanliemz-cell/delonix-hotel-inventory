import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ahompvfhgndlyjdocmiq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFob21wdmZoZ25kbHlqZG9jbWlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjgyNTMsImV4cCI6MjA4OTU0NDI1M30.58WSF-L9w4mImsY2Y7IH50mvZMxFLgCGwp8_dTQsH1A';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'inventory' }
});
