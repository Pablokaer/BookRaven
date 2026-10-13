-- The app was renamed from Mico-livrão to BookRaven; rename the public-domain system account too.
UPDATE "user" SET name = 'BookRaven Library', "updatedAt" = now()
WHERE email = 'library@readsync.local' AND name = 'Mico-livrão Library';
