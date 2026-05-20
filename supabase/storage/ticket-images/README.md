# `ticket-images` bucket (virtual folder layout)

This folder in the repo is **documentation only**.  
The real bucket lives in Supabase Storage.

When users attach photos in FLOW, files are stored as:

```text
ticket-images/{projectId}/{ticketId}/{timestamp}.jpg
```

Example after one upload:

```text
ticket-images/
  a1b2c3d4-...-project/
    e5f6g7h8-...-ticket/
      1716192030456.png
```

Setup: run **`../setup.sql`** or follow **`../MANUAL-SETUP.md`**.
