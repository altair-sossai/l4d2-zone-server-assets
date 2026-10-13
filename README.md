# l4d2-zone-server-assets

Static files used by [l4d2-zone-server](https://github.com/altair-sossai/l4d2-zone-server), kept in a separate repository so the heavy files are only deployed when they change.

| Folder       | Game server (`/home/steam/l4d2/left4dead2/`) | Azure Blob Storage (`l4d2playstats`) |
|--------------|----------------------------------------------|--------------------------------------|
| `models/`    | `models/`                                    | `fastdl/models/`                     |
| `materials/` | `materials/`                                 | `fastdl/materials/`                  |
| `fastdl/`    | —                                            | `fastdl/`                            |
| `assets/`    | —                                            | `assets/`                            |

- `models/` and `materials/` must exist on the server (the plugins precache them) and on the FastDL (clients download them).
- `fastdl/` holds files that only clients download (e.g. patent sprites).
- `assets/` holds the MOTD and host pages and images shown in game.

The pipeline in `azure-pipelines.yml` runs on every push to `main`.
