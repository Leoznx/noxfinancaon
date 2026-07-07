-- Allow authenticated users to read proofs
CREATE POLICY "Anyone authenticated can view proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'comprovantes-saque');

-- Allow admins to upload proofs
CREATE POLICY "Admins can upload proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comprovantes-saque' 
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);
