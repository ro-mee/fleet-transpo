-- Add vehicle-images bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('vehicle-images', 'vehicle-images', true) 
ON CONFLICT (id) DO NOTHING;
