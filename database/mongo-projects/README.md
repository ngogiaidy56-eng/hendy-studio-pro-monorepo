# Mongo project documents

Timeline state is stored as a versioned document so clip/track metadata can evolve without changing relational identity tables. The application creates indexes on `ownerId` and timestamps on startup. Apply `validator.json` manually when enabling MongoDB collection validation in production. Keep authorization owner-scoped in API queries.
