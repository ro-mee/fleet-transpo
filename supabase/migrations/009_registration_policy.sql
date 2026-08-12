-- Allow anonymous inserts during registration
CREATE POLICY "Anyone can insert during registration"
  ON employees FOR INSERT
  WITH CHECK (auth.role() = 'anon');

-- Allow anonymous SELECT to check for existing email during registration
CREATE POLICY "Anyone can check email during registration"
  ON employees FOR SELECT
  USING (auth.role() = 'anon');
