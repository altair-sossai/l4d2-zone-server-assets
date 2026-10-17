# l4d2-zone-server-assets

🌐 **English** | [Português](README.pt.md) | [Español](README.es.md)

Static files used by [l4d2-zone-server](https://github.com/altair-sossai/l4d2-zone-server), kept in a separate repository so the heavy files are only deployed when they change.

| Folder       | Game server (`/home/steam/l4d2/left4dead2/`) | Azure Blob Storage (`l4d2playstats`, `container/path`) |
|--------------|----------------------------------------------|--------------------------------------------------------|
| `models/`    | `models/`                                    | `fastdl/models/`                                       |
| `materials/` | `materials/`                                 | `fastdl/materials/`                                    |
| `fastdl/`    | —                                            | `fastdl/`                                              |
| `assets/`    | —                                            | `assets/`                                              |

- `models/` and `materials/` must exist on the server (the plugins precache them and add them to the downloads table) and on the FastDL (clients download them).
  - `models/l4d2br/weapons/<weapon>/` holds one combined view model (`v.*`) and world model (`w.*`) per weapon, with one skin family per skin.
  - `materials/models/l4d2br/weapons/<weapon>_<workshopId>/` holds the textures of one skin.
  - `materials/decals/l4d2br/` holds the decals of the `map-decals` plugin.
- `fastdl/` holds files that only clients download: the patent sprites of `l4d2_show_patent_icon` (`materials/sprites/`) and a copy of the decals. Its contents go to the root of the FastDL, next to `models/` and `materials/`.
- `assets/` holds the MOTD and host pages (`motd.html`, `host.html`), the images they show (`.jpeg`) and their Photoshop sources (`.psd`).
- `assets/skin-shots/<skin>/` holds the in-game photos of each weapon skin shown in the site shop, made with [l4d2-screenshot-studio](https://github.com/altair-sossai/l4d2-screenshot-studio). Each skin has six photos (`1` first person, `2` to `4` on the ground, `5` and `6` in third person) in AVIF and WebP: `N` is 1280×720, `N-thumb` is 320×180 and `N-card` (photos 1, 5 and 6) is a 540 px square for the shop card. They are served with a one-year cache, so a skin whose photos are redone needs its `shots` version raised in the site's `skins.json`.

`.gitattributes` normalizes text files (`.vmt`, `.html`) to LF and keeps models, textures and images binary; that is what the server and the FastDL receive.

## Using the files on your own server

### Game server

Copy `models/` and `materials/` into the game folder (the one with `gameinfo.txt`), for example:

```bash
rsync -a models materials <user>@<server-host>:<game-folder>/
```

The `ansible/setup-server.yml` playbook of l4d2-zone-server does the same copy when a server is first set up (its header says it was not tested against a real server yet). `fastdl/` and `assets/` are not copied to the server.

The `l4d2_weapon_skins` plugin reads [`addons/sourcemod/configs/weapon_skins.cfg`](https://github.com/altair-sossai/l4d2-zone-server/blob/master/addons/sourcemod/configs/weapon_skins.cfg) of l4d2-zone-server: every `view_model`, `world_model`, `models` and `materials` path there must exist in the game folder, or the plugin logs `models were not found on the server` / `materials were not found on the server` and skips that weapon or skin. Restart the server while it is empty after the models change, so players download them on connect instead of during a map change.

### FastDL

Clients download from `sv_downloadurl`, which l4d2-zone-server sets in `cfg/server.cfg` together with `sv_allowdownload 1`:

```
sm_cvar sv_downloadurl "https://<your-fastdl-host>/<path>"
```

The URL must point to a folder laid out like the game folder: `models/` and `materials/` from this repository, plus the contents of `fastdl/` merged into the same root. Files are served uncompressed (no `.bz2`). Any static HTTP host works, for example:

```bash
rsync -a models materials <user>@<web-host>:<web-root>/fastdl/
rsync -a fastdl/ <user>@<web-host>:<web-root>/fastdl/
```

With Azure Blob Storage, as this server does, create a `fastdl` and an `assets` container with anonymous read access to blobs (the account must allow anonymous blob access), and set `sv_downloadurl` to `https://<storage-account>.blob.core.windows.net/fastdl`:

```bash
az storage container create --account-name <storage-account> --name fastdl --public-access blob --auth-mode login
az storage container create --account-name <storage-account> --name assets --public-access blob --auth-mode login
```

No CORS rule is needed: the game client and the site's `<img>` tags fetch the files directly. Only the skin photos get a `Cache-Control` header (`public, max-age=31536000, immutable`); every other file is uploaded without one.

### MOTD and host pages

l4d2-zone-server sets `motdfile "motd.txt"` and `hostfile "host.txt"`; each of those files holds only the URL of `assets/motd.html` or `assets/host.html`, and each page shows its `.jpeg` from the `assets` container. To use your own host, change the image URL inside `motd.html` and `host.html`, upload `assets/`, and put the new page URLs in `motd.txt` and `host.txt`. The current URLs use plain `http://`, so keep the host reachable over HTTP or change them to `https://`.

## Deployment pipeline

The pipeline in `azure-pipelines.yml` (Azure DevOps) runs on every push to `main`:

1. packs `models/` and `materials/` into `.tar.gz` files;
2. uploads them over SSH to `remoteTempFolder` and extracts them into `gameFolder/models` and `gameFolder/materials`;
3. syncs `assets/skin-shots/` (with the one-year cache), the rest of `assets/` to the `assets` container, and `fastdl/`, `models/` and `materials/` to the `fastdl` container.

The server copy sends every file on every run; the blob sync sends only new or changed files. Neither step deletes anything, so a file removed from the repository must also be removed by hand from the game folder and from the storage.

To run it with your own server and storage:

| What | Where in `azure-pipelines.yml` | Value |
|------|--------------------------------|-------|
| Branch | `trigger` | the branch that deploys (`main`) |
| SSH service connection | `sshServiceConnection` | name of an SSH service connection to your server; its user must be able to write to `remoteTempFolder` and `gameFolder` |
| Temporary folder on the server | `remoteTempFolder` | for example `/home/<ssh-user>/zone-server-assets` |
| Game folder | `gameFolder` | `<game-folder>` (the folder with `gameinfo.txt`) |
| Azure service connection | `azureSubscription` of the `AzureCLI@2` step | name of an Azure Resource Manager service connection whose identity can list and upload blobs in the account |
| Storage account | `--account` in the inline script | `<storage-account>` |

The `fastdl` and `assets` containers must exist before the first run: the sync script does not create them. If you only use the game server or only the storage, remove the steps you do not need.

### scripts/sync-blob.sh

Uploads to Azure Blob Storage go through `scripts/sync-blob.sh`, which compares the MD5 of every local file with the blob's `Content-MD5` and uploads only new or changed files. Nothing is deleted from the storage.

```
sync-blob.sh [--account <name>] --container <name> --source <dir> [--prefix <path>] [--cache-control <value>] [--dry-run]
```

| Option | Meaning |
|--------|---------|
| `--account` | Storage account name. Without it, the storage comes from `AZURE_STORAGE_CONNECTION_STRING` |
| `--container` | Target container (must exist) |
| `--source` | Local folder; its relative paths become the blob names |
| `--prefix` | Blob path prefix (for example `models`); only blobs under it are compared |
| `--cache-control` | `Cache-Control` set on the uploaded blobs |
| `--dry-run` | Lists the files that would be uploaded and uploads nothing |

It needs `bash`, the Azure CLI (`az`), `openssl`, `base64` and the usual coreutils (`find`, `sort`, `comm`, `mktemp`). `az` must be able to read and write the container: either signed in (`az login`, or the Azure service connection in the pipeline) with `--account`, or with `AZURE_STORAGE_CONNECTION_STRING` set and no `--account`. AVIF and WebP files are uploaded with `image/avif` and `image/webp`; other files get the content type `az` infers. The script fails when the number of uploaded files differs from the number of changed files.

A dry run still lists the container, so it needs the same access. To see what a push would upload without uploading anything:

```bash
bash scripts/sync-blob.sh --account <storage-account> --container assets --source assets --dry-run
AZURE_STORAGE_CONNECTION_STRING='<connection-string>' bash scripts/sync-blob.sh --container fastdl --source fastdl --dry-run
```

## Adding a new skin

The skin id is the same in every place below (for example `dark-matter`). The full checklist, including the combined model format, is in the [l4d2-zone-server wiki](https://github.com/altair-sossai/l4d2-zone-server/blob/master/docs/weapon-skins/02-assets.md#adding-a-new-skin-checklist).

1. Use only a texture-only Steam Workshop skin for the stock model of a supported weapon, and only if its author allows redistribution.
2. **This repository:** put its materials in `materials/models/l4d2br/weapons/<weapon>_<workshopId>/`, with the paths inside each `.vmt` pointing to that folder (textures at most 1024 px). Rebuild that weapon's combined models in `models/l4d2br/weapons/<weapon>/`: the skin family index is the skin's position among that weapon's skins in `weapon_skins.cfg`. The tools that build the combined models are not versioned yet.
3. **This repository:** add the photos in `assets/skin-shots/<id>/` (30 files, as described above) and a row in the [credits table](#weapon-skin-credits) of its weapon, updating the count in the heading and the list of authors.
4. **l4d2-zone-server:** add the skin to the `Skins` section of `addons/sourcemod/configs/weapon_skins.cfg` (`weapon`, `skin` family index, `materials` folder), and update the `skin` index of any skin whose position changed.
5. **[l4d2-playstats-web](https://github.com/altair-sossai/l4d2-playstats-web):** add an entry to `L4D2PlayStats.Web/L4D2PlayStats.Core/Skins/Data/skins.json` (copy an existing one: `id`, `weapon`, `rarity`, `price`, `workshopId`, `shots`, `author`, titles and descriptions in en/pt/es) and its thumbnail `L4D2PlayStats.Web/L4D2PlayStats.Web/wwwroot/imgs/skins/<id>.jpg`. With `shots` at `0` the shop shows only the thumbnail; with `1` or more it loads the photos from `<SkinShotsUrl>/<id>/` (`SkinShotsUrl` in the site settings, default `https://l4d2playstats.blob.core.windows.net/assets/skin-shots`).
6. Deploy in the order given in [Operations → When the combined models change](https://github.com/altair-sossai/l4d2-zone-server/blob/master/docs/weapon-skins/06-operations.md#when-the-combined-models-change), then restart the game server while it is empty.

## Checking that clients download the files

1. The FastDL answers with `200` for a file in the downloads table:

   ```bash
   curl -I https://<your-fastdl-host>/<path>/models/l4d2br/weapons/smg/v.mdl
   ```

2. On the server, `sm plugins info l4d2_weapon_skins` shows `running` and the SourceMod error log of the day has no `not found on the server` lines.
3. A client with `cl_allowdownload 1` shows the downloads while connecting, and the weapon uses the skin after it is equipped. The plugin always sends the models of every configured weapon, but only the materials of skins someone bought (or of every skin with `weapon_skins_preview_all 1`), so test with a bought skin.

If a weapon shows `ERROR`, the models were downloaded during a map change: restart the game. More cases are in the [troubleshooting table](https://github.com/altair-sossai/l4d2-zone-server/blob/master/docs/weapon-skins/06-operations.md#troubleshooting).

## Weapon skin credits

Every weapon skin in `models/l4d2br/weapons` and `materials/models/l4d2br/weapons` was made by the Left 4 Dead 2 community and published on the Steam Workshop. Thank you to all the authors below: the skins are theirs, and this server only adapts them (the textures are moved to their own folders, resized when larger than 1024 px and combined into one model per weapon) so players can download them from the server.

Skins whose authors ask not to redistribute them are not used. If you are one of the authors and want your work credited differently or removed, please open an issue in this repository.

### SMG (8)

| Skin | Author | Workshop |
|------|--------|----------|
| Arknights Rosmontis Dynamic Skin SMG (UZI) (Glow) | [如群星般Blossom\_AID](https://steamcommunity.com/profiles/76561198118821360) | [2848790132](https://steamcommunity.com/sharedfiles/filedetails/?id=2848790132) |
| Azur Lane Jean Bart (Première Neige) UZI | [Rumia](https://steamcommunity.com/profiles/76561199069540290) | [3510709531](https://steamcommunity.com/sharedfiles/filedetails/?id=3510709531) |
| Default SMG: Hatsune Miku (Pearlescent) | [鹿目徳門+](https://steamcommunity.com/profiles/76561199446396908) | [3299514548](https://steamcommunity.com/sharedfiles/filedetails/?id=3299514548) |
| Hiiro UZI (Glow) | [有鹿来](https://steamcommunity.com/profiles/76561198824737114) | [2809240839](https://steamcommunity.com/sharedfiles/filedetails/?id=2809240839) |
| Miku UZI | [KoyomiLi](https://steamcommunity.com/profiles/76561198200063591) | [772143939](https://steamcommunity.com/sharedfiles/filedetails/?id=772143939) |
| Uzi \| Volcanic | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2037879288](https://steamcommunity.com/sharedfiles/filedetails/?id=2037879288) |
| UZI Printstream | [Nagasaki Soyo](https://steamcommunity.com/profiles/76561198979336170) | [2924725708](https://steamcommunity.com/sharedfiles/filedetails/?id=2924725708) |
| Wagamama High Spec Narumi Toa UZI | [bliss](https://steamcommunity.com/profiles/76561198862737859) | [3335472907](https://steamcommunity.com/sharedfiles/filedetails/?id=3335472907) |

### Silenced SMG (MAC-10) (30)

| Skin | Author | Workshop |
|------|--------|----------|
| "Vercetti Vintage" MAC-10 Reskin | [konkeso](https://steamcommunity.com/profiles/76561198970880706) | [3791846410](https://steamcommunity.com/sharedfiles/filedetails/?id=3791846410) |
| Arknights Mulberry MAC-10 | [卤香牛肉面](https://steamcommunity.com/profiles/76561198327025816) | [2610503147](https://steamcommunity.com/sharedfiles/filedetails/?id=2610503147) |
| Arknights Surtr Silenced SMG Dynamic Skin (Glow) | [如群星般Blossom\_AID](https://steamcommunity.com/profiles/76561198118821360) | [2845730284](https://steamcommunity.com/sharedfiles/filedetails/?id=2845730284) |
| Default Silenced SMG: Hatsune Miku (Glow) | [鹿目徳門+](https://steamcommunity.com/profiles/76561199446396908) | [3271509074](https://steamcommunity.com/sharedfiles/filedetails/?id=3271509074) |
| Ethereal MAC-10 Skin | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3413132036](https://steamcommunity.com/sharedfiles/filedetails/?id=3413132036) |
| Find My Future MAC-10 | [Nuj02](https://steamcommunity.com/profiles/76561199229538843) | [3160988312](https://steamcommunity.com/sharedfiles/filedetails/?id=3160988312) |
| Hiiro MAC-10 | [比宇宙更远的地方](https://steamcommunity.com/profiles/76561198973812143) | [2713502936](https://steamcommunity.com/sharedfiles/filedetails/?id=2713502936) |
| Izumi Hiyori MAC-10 | [bliss](https://steamcommunity.com/profiles/76561198862737859) | [3374437391](https://steamcommunity.com/sharedfiles/filedetails/?id=3374437391) |
| K-ON! Ritsu Tainaka MAC-10 | [ABLACK-A.S](https://steamcommunity.com/profiles/76561199201139601) | [3769476345](https://steamcommunity.com/sharedfiles/filedetails/?id=3769476345) |
| MAC-10 Dark Matter | [BATTLE NO.1](https://steamcommunity.com/profiles/76561199147992281) | [3377651383](https://steamcommunity.com/sharedfiles/filedetails/?id=3377651383) |
| MAC-10 Volcanic Lava Skin | [BATTLE NO.1](https://steamcommunity.com/profiles/76561199147992281) | [3381870803](https://steamcommunity.com/sharedfiles/filedetails/?id=3381870803) |
| MAC-10-S \| Neon Rider | [Alex\_D \#NoWar](https://steamcommunity.com/profiles/76561198012689307) | [826430944](https://steamcommunity.com/sharedfiles/filedetails/?id=826430944) |
| Mac10 - PrintStream | [《Happi Doggo》](https://steamcommunity.com/profiles/76561198804859540) | [2915661033](https://steamcommunity.com/sharedfiles/filedetails/?id=2915661033) |
| multoman's RNG Skins Separated: Case Hardened MAC-10 | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3361646012](https://steamcommunity.com/sharedfiles/filedetails/?id=3361646012) |
| multoman's RNG Skins Separated: DDPAT Desert MAC-10 | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3361641020](https://steamcommunity.com/sharedfiles/filedetails/?id=3361641020) |
| multoman's RNG Skins Separated: Olive Finish MAC-10 | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3361637405](https://steamcommunity.com/sharedfiles/filedetails/?id=3361637405) |
| multoman's RNG Skins Separated: Patriotic MAC-10 | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3361636124](https://steamcommunity.com/sharedfiles/filedetails/?id=3361636124) |
| multoman's RNG Skins Separated: Patriotic MAC-10 (TLS Version) | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3426201673](https://steamcommunity.com/sharedfiles/filedetails/?id=3426201673) |
| multoman's RNG Skins Separated: Red Finish MAC-10 | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3361634998](https://steamcommunity.com/sharedfiles/filedetails/?id=3361634998) |
| multoman's RNG Skins Separated: Two Tone DBDU MAC-10 | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3361643179](https://steamcommunity.com/sharedfiles/filedetails/?id=3361643179) |
| Nekoha Shizuku SMG (MAC-10) Remake (Glow) | [有鹿来](https://steamcommunity.com/profiles/76561198824737114) | [2808871797](https://steamcommunity.com/sharedfiles/filedetails/?id=2808871797) |
| Printstream MAC-10 | [星跃迁](https://steamcommunity.com/profiles/76561198450183507) | [2926162402](https://steamcommunity.com/sharedfiles/filedetails/?id=2926162402) |
| Rat A Tat Tat (Glowing) | [SherlockHolmes9™](https://steamcommunity.com/profiles/76561198144229031) | [2020709816](https://steamcommunity.com/sharedfiles/filedetails/?id=2020709816) |
| RGB MAC-10 Disco Tech (Glow) | [十年公交男](https://steamcommunity.com/profiles/76561198848049874) | [2656086089](https://steamcommunity.com/sharedfiles/filedetails/?id=2656086089) |
| S.SMG \| ShadowBolt | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1891172953](https://steamcommunity.com/sharedfiles/filedetails/?id=1891172953) |
| Silenced SMG\_Urban | [Drunken Irishman](https://steamcommunity.com/profiles/76561198067821017) | [1883809532](https://steamcommunity.com/sharedfiles/filedetails/?id=1883809532) |
| SMG | [reprol](https://steamcommunity.com/profiles/76561199195148539) | [3506807539](https://steamcommunity.com/sharedfiles/filedetails/?id=3506807539) |
| Solid Pink & Black Silenced SMG | [death. by dolls ꔫ](https://steamcommunity.com/profiles/76561199063522016) | [3384494412](https://steamcommunity.com/sharedfiles/filedetails/?id=3384494412) |
| Worn MAC-10 - Shiny Riolu | [TheOneChicken](https://steamcommunity.com/profiles/76561198126786969) | [3534662352](https://steamcommunity.com/sharedfiles/filedetails/?id=3534662352) |
| Yuzusoft Arihara Nanami MAC-10 | [bliss](https://steamcommunity.com/profiles/76561198862737859) | [3351643762](https://steamcommunity.com/sharedfiles/filedetails/?id=3351643762) |

### MP5 (20)

| Skin | Author | Workshop |
|------|--------|----------|
| MP5 - A Force for Order | [SherlockHolmes9™](https://steamcommunity.com/profiles/76561198144229031) | [2043382451](https://steamcommunity.com/sharedfiles/filedetails/?id=2043382451) |
| MP5 - Battle Worn | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503590830](https://steamcommunity.com/sharedfiles/filedetails/?id=3503590830) |
| MP5 - Black Tactical | [HitSmoker](https://steamcommunity.com/profiles/76561198096066478) | [2415413374](https://steamcommunity.com/sharedfiles/filedetails/?id=2415413374) |
| MP5 - Damascus (Glow) | [BATTLE NO.1](https://steamcommunity.com/profiles/76561199147992281) | [3123871890](https://steamcommunity.com/sharedfiles/filedetails/?id=3123871890) |
| MP5 - Desert Sand | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503591460](https://steamcommunity.com/sharedfiles/filedetails/?id=3503591460) |
| MP5 - Dirty Silver | [izida1005](https://steamcommunity.com/profiles/76561199608610386) | [3468733406](https://steamcommunity.com/sharedfiles/filedetails/?id=3468733406) |
| MP5 - FDE Tactical | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503592122](https://steamcommunity.com/sharedfiles/filedetails/?id=3503592122) |
| MP5 - Flareon | [Ga(z)imon](https://steamcommunity.com/profiles/76561198088730923) | [3440232168](https://steamcommunity.com/sharedfiles/filedetails/?id=3440232168) |
| MP5 - Gold'n'Pearl | [《Happi Doggo》](https://steamcommunity.com/profiles/76561198804859540) | [2958413323](https://steamcommunity.com/sharedfiles/filedetails/?id=2958413323) |
| MP5 - Navy Blue | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503592659](https://steamcommunity.com/sharedfiles/filedetails/?id=3503592659) |
| MP5 - Olive Drab | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503593705](https://steamcommunity.com/sharedfiles/filedetails/?id=3503593705) |
| MP5 - Purple Camo | [《Happi Doggo》](https://steamcommunity.com/profiles/76561198804859540) | [2878386179](https://steamcommunity.com/sharedfiles/filedetails/?id=2878386179) |
| MP5 - RAL 8000 | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503594155](https://steamcommunity.com/sharedfiles/filedetails/?id=3503594155) |
| MP5 - Rarity | [Vampiturra (⌐■\_■)](https://steamcommunity.com/profiles/76561199222348819) | [3762715599](https://steamcommunity.com/sharedfiles/filedetails/?id=3762715599) |
| MP5 - Rusted | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503595463](https://steamcommunity.com/sharedfiles/filedetails/?id=3503595463) |
| MP5 - Silver | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3332413493](https://steamcommunity.com/sharedfiles/filedetails/?id=3332413493) |
| MP5 - Touhou Michigami Nareko | [蕾米莉亞親衛隊](https://steamcommunity.com/profiles/76561198302632895) | [3547369289](https://steamcommunity.com/sharedfiles/filedetails/?id=3547369289) |
| MP5 - Two Tone | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3503595929](https://steamcommunity.com/sharedfiles/filedetails/?id=3503595929) |
| MP5 - Volcanic Lava | [BATTLE NO.1](https://steamcommunity.com/profiles/76561199147992281) | [3381943137](https://steamcommunity.com/sharedfiles/filedetails/?id=3381943137) |
| MP5 - Watergun | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3349350731](https://steamcommunity.com/sharedfiles/filedetails/?id=3349350731) |

### Pump Shotgun (33)

| Skin | Author | Workshop |
|------|--------|----------|
| Azur Lane Jean Bart Pump Shotgun | [Rumia](https://steamcommunity.com/profiles/76561199069540290) | [3503214599](https://steamcommunity.com/sharedfiles/filedetails/?id=3503214599) |
| B-sha (Megadimension Neptunia VII) - Pump Shotgun | [ジャレッド](https://steamcommunity.com/profiles/76561198287332761) | [2836847839](https://steamcommunity.com/sharedfiles/filedetails/?id=2836847839) |
| Big the Cat Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [3703964121](https://steamcommunity.com/sharedfiles/filedetails/?id=3703964121) |
| Bocchi the Rock! Yamada Ryo Pump Shotgun | [这并不好笑](https://steamcommunity.com/profiles/76561198370506425) | [3382999407](https://steamcommunity.com/sharedfiles/filedetails/?id=3382999407) |
| Boykisser Pump Shotgun | [PurpleLichious](https://steamcommunity.com/profiles/76561198992841006) | [3567209245](https://steamcommunity.com/sharedfiles/filedetails/?id=3567209245) |
| Clodsire Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2946973675](https://steamcommunity.com/sharedfiles/filedetails/?id=2946973675) |
| Doki Doki Literature Club! Sayori | [西南老表](https://steamcommunity.com/profiles/76561199433838559) | [3175242980](https://steamcommunity.com/sharedfiles/filedetails/?id=3175242980) |
| Dragonite Pumpshotgun v2 | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [3353717701](https://steamcommunity.com/sharedfiles/filedetails/?id=3353717701) |
| Fuecoco Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2893293186](https://steamcommunity.com/sharedfiles/filedetails/?id=2893293186) |
| Glamrock Freddy Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2827288336](https://steamcommunity.com/sharedfiles/filedetails/?id=2827288336) |
| Halloween Ghost Pump Shotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2622374394](https://steamcommunity.com/sharedfiles/filedetails/?id=2622374394) |
| Hatsune Miku 16th Anniversary Default Pumpshotgun Skin (Glow) | [鹿目徳門+](https://steamcommunity.com/profiles/76561199446396908) | [3028562598](https://steamcommunity.com/sharedfiles/filedetails/?id=3028562598) |
| Hyperdimension Neptunia Plutia Pumpshotgun | [Sa-Daniels](https://steamcommunity.com/profiles/76561198043631800) | [2622698544](https://steamcommunity.com/sharedfiles/filedetails/?id=2622698544) |
| Kao the Kangaroo Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2815653917](https://steamcommunity.com/sharedfiles/filedetails/?id=2815653917) |
| Lord Darkdread Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2988115895](https://steamcommunity.com/sharedfiles/filedetails/?id=2988115895) |
| PORT: Tiger Striped Pump Shotgun Skin | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3353440278](https://steamcommunity.com/sharedfiles/filedetails/?id=3353440278) |
| Pump \| Gumi | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1996782682](https://steamcommunity.com/sharedfiles/filedetails/?id=1996782682) |
| Pump \| Pumpkin Patch | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2247225793](https://steamcommunity.com/sharedfiles/filedetails/?id=2247225793) |
| Pump \| Victorian | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2013771916](https://steamcommunity.com/sharedfiles/filedetails/?id=2013771916) |
| Pump Shotgun Printstream Theme (Glow) | [十年公交男](https://steamcommunity.com/profiles/76561198848049874) | [3020518865](https://steamcommunity.com/sharedfiles/filedetails/?id=3020518865) |
| Pump Shotgun Skin: Sleep at Night | [kklkl](https://steamcommunity.com/profiles/76561199496633553) | [3208967272](https://steamcommunity.com/sharedfiles/filedetails/?id=3208967272) |
| Pump Shotgun: Kunzite | [HardToImaginePrideEverChanging](https://steamcommunity.com/profiles/76561198449238509) | [2979000170](https://steamcommunity.com/sharedfiles/filedetails/?id=2979000170) |
| Shiny Charizard Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2778467302](https://steamcommunity.com/sharedfiles/filedetails/?id=2778467302) |
| Shiny Pumpkaboo Pump Shotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2640388420](https://steamcommunity.com/sharedfiles/filedetails/?id=2640388420) |
| Shotguns \| Volcanic | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1898445622](https://steamcommunity.com/sharedfiles/filedetails/?id=1898445622) |
| Slowpoke Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2759848284](https://steamcommunity.com/sharedfiles/filedetails/?id=2759848284) |
| Soviet Pump Shotgun | [Starlight](https://steamcommunity.com/profiles/76561198812747106) | [3235542431](https://steamcommunity.com/sharedfiles/filedetails/?id=3235542431) |
| Sprigatito Wooden Shotgun | [Jamar2211](https://steamcommunity.com/profiles/76561198886170298) | [3279582587](https://steamcommunity.com/sharedfiles/filedetails/?id=3279582587) |
| Toxic Hazard Pump Shotgun | [Starlight](https://steamcommunity.com/profiles/76561198812747106) | [3232260090](https://steamcommunity.com/sharedfiles/filedetails/?id=3232260090) |
| Tribal Hunter Honey Dragon Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [2558200493](https://steamcommunity.com/sharedfiles/filedetails/?id=2558200493) |
| Uma Musume Mejiro McQueen Pump Shotgun | [Nagasaki Soyo](https://steamcommunity.com/profiles/76561198979336170) | [2810642280](https://steamcommunity.com/sharedfiles/filedetails/?id=2810642280) |
| Up Close and Personal (Glowing) | [SherlockHolmes9™](https://steamcommunity.com/profiles/76561198144229031) | [2019982092](https://steamcommunity.com/sharedfiles/filedetails/?id=2019982092) |
| Yoshi Pumpshotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [3730362238](https://steamcommunity.com/sharedfiles/filedetails/?id=3730362238) |

### Chrome Shotgun (34)

| Skin | Author | Workshop |
|------|--------|----------|
| Asiimov Chrome Shotgun | [Amel](https://steamcommunity.com/profiles/76561198065445389) | [504708297](https://steamcommunity.com/sharedfiles/filedetails/?id=504708297) |
| Azur Lane USS Enterprise Chrome | [Sa-Daniels](https://steamcommunity.com/profiles/76561198043631800) | [2621473254](https://steamcommunity.com/sharedfiles/filedetails/?id=2621473254) |
| Black Tactical Chrome Shotgun | [HitSmoker](https://steamcommunity.com/profiles/76561198096066478) | [2453777915](https://steamcommunity.com/sharedfiles/filedetails/?id=2453777915) |
| Cardcaptor Sakura Chrome Shotgun | [叫声爸爸救你](https://steamcommunity.com/profiles/76561198842020028) | [2848781046](https://steamcommunity.com/sharedfiles/filedetails/?id=2848781046) |
| Chrome \| Anubis | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1973325659](https://steamcommunity.com/sharedfiles/filedetails/?id=1973325659) |
| Chrome \| Celeuna | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1896292547](https://steamcommunity.com/sharedfiles/filedetails/?id=1896292547) |
| Chrome \| Hot Rod | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2012965052](https://steamcommunity.com/sharedfiles/filedetails/?id=2012965052) |
| Chrome Shotgun \| Asiimov Light Blue | [kΛmesan](https://steamcommunity.com/profiles/76561198271003114) | [2607196353](https://steamcommunity.com/sharedfiles/filedetails/?id=2607196353) |
| Chrome Shotgun Black&Gold Skin | [卡卡™](https://steamcommunity.com/profiles/76561198979410407) | [2418491788](https://steamcommunity.com/sharedfiles/filedetails/?id=2418491788) |
| Chrome Shotgun Inferno | [Drunken Irishman](https://steamcommunity.com/profiles/76561198067821017) | [1538174590](https://steamcommunity.com/sharedfiles/filedetails/?id=1538174590) |
| Chrome Shotgun Printstream Imitation | [Kokkorylien](https://steamcommunity.com/profiles/76561198212071259) | [2862073814](https://steamcommunity.com/sharedfiles/filedetails/?id=2862073814) |
| Chrome Shotgun Printstream Theme (Glow) | [十年公交男](https://steamcommunity.com/profiles/76561198848049874) | [3020518619](https://steamcommunity.com/sharedfiles/filedetails/?id=3020518619) |
| Chrome Shotgun Umbreon Camo | [Xavier](https://steamcommunity.com/profiles/76561198185766111) | [2142826115](https://steamcommunity.com/sharedfiles/filedetails/?id=2142826115) |
| Chrome Shotgun\_Wildfire | [Drunken Irishman](https://steamcommunity.com/profiles/76561198067821017) | [2123530345](https://steamcommunity.com/sharedfiles/filedetails/?id=2123530345) |
| Chrome Shotgun: Kunzite | [HardToImaginePrideEverChanging](https://steamcommunity.com/profiles/76561198449238509) | [2979010150](https://steamcommunity.com/sharedfiles/filedetails/?id=2979010150) |
| Chrome Shotgun: Ruby | [HardToImaginePrideEverChanging](https://steamcommunity.com/profiles/76561198449238509) | [3023845538](https://steamcommunity.com/sharedfiles/filedetails/?id=3023845538) |
| Chrome Shotgun: Sapphire | [HardToImaginePrideEverChanging](https://steamcommunity.com/profiles/76561198449238509) | [3020820801](https://steamcommunity.com/sharedfiles/filedetails/?id=3020820801) |
| Chrome Shotgun: Star Ruby | [HardToImaginePrideEverChanging](https://steamcommunity.com/profiles/76561198449238509) | [3031900671](https://steamcommunity.com/sharedfiles/filedetails/?id=3031900671) |
| Default Chrome Shotgun: Corridor of Miku | [鹿目徳門+](https://steamcommunity.com/profiles/76561199446396908) | [3304384199](https://steamcommunity.com/sharedfiles/filedetails/?id=3304384199) |
| Google Chrome Shotgun | [Starlight](https://steamcommunity.com/profiles/76561198812747106) | [3233682675](https://steamcommunity.com/sharedfiles/filedetails/?id=3233682675) |
| K-ON! Mio Akiyama Chrome Shotgun | [一只柒](https://steamcommunity.com/profiles/76561199523448244) | [3589156415](https://steamcommunity.com/sharedfiles/filedetails/?id=3589156415) |
| King Dedede Chrome Shotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [3430694346](https://steamcommunity.com/sharedfiles/filedetails/?id=3430694346) |
| Minato Aqua Chrome Shotgun (Glow) | [薄雪中意晚莲](https://steamcommunity.com/profiles/76561198868564103) | [2840087428](https://steamcommunity.com/sharedfiles/filedetails/?id=2840087428) |
| Minato Aqua Chrome Shotgun II (Glow) | [薄雪中意晚莲](https://steamcommunity.com/profiles/76561198868564103) | [2840154085](https://steamcommunity.com/sharedfiles/filedetails/?id=2840154085) |
| multoman's RNG Skins Separated: Cerakote Blue Chrome Shotgun | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3380608963](https://steamcommunity.com/sharedfiles/filedetails/?id=3380608963) |
| multoman's RNG Skins Separated: Plastic Orange Chrome Shotgun | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3380605774](https://steamcommunity.com/sharedfiles/filedetails/?id=3380605774) |
| Nekomiya Hinata Chrome Shotgun v2.0 (Glow) | [薄雪中意晚莲](https://steamcommunity.com/profiles/76561198868564103) | [2814124024](https://steamcommunity.com/sharedfiles/filedetails/?id=2814124024) |
| PORT: Caution Chrome Shotgun Skin | [igames](https://steamcommunity.com/profiles/76561198407554343) | [3353441204](https://steamcommunity.com/sharedfiles/filedetails/?id=3353441204) |
| Scott The Woz Chrome Shotgun | [Spiralt](https://steamcommunity.com/profiles/76561198125045326) | [2789609798](https://steamcommunity.com/sharedfiles/filedetails/?id=2789609798) |
| Segawa Emi Chrome Shotgun | [bliss](https://steamcommunity.com/profiles/76561198862737859) | [3225009583](https://steamcommunity.com/sharedfiles/filedetails/?id=3225009583) |
| Shiny Miltank Chrome Shotgun | [Bonnie](https://steamcommunity.com/profiles/76561198073812490) | [1743997241](https://steamcommunity.com/sharedfiles/filedetails/?id=1743997241) |
| Shotguns \| Volcanic | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1898445622](https://steamcommunity.com/sharedfiles/filedetails/?id=1898445622) |
| Uma Musume Tokai Teio Chrome Shotgun | [Nagasaki Soyo](https://steamcommunity.com/profiles/76561198979336170) | [2805481477](https://steamcommunity.com/sharedfiles/filedetails/?id=2805481477) |
| Yuzusoft Yarai Miu Chrome Shotgun | [bliss](https://steamcommunity.com/profiles/76561198862737859) | [3539372350](https://steamcommunity.com/sharedfiles/filedetails/?id=3539372350) |

### Magnum (Desert Eagle) (26)

| Skin | Author | Workshop |
|------|--------|----------|
| Alternative Desert Eagle | [Lyreck](https://steamcommunity.com/profiles/76561198161511517) | [2818007735](https://steamcommunity.com/sharedfiles/filedetails/?id=2818007735) |
| Bombastic Magnum | [red apple](https://steamcommunity.com/profiles/76561198373741233) | [2727986985](https://steamcommunity.com/sharedfiles/filedetails/?id=2727986985) |
| Dead Trigger 2 Desert Eagle | [multo](https://steamcommunity.com/profiles/76561199001846248) | [3365446394](https://steamcommunity.com/sharedfiles/filedetails/?id=3365446394) |
| Deagle \| Anubis | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1973329455](https://steamcommunity.com/sharedfiles/filedetails/?id=1973329455) |
| Deagle \| Exodus | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2009408794](https://steamcommunity.com/sharedfiles/filedetails/?id=2009408794) |
| Deagle \| Mar13 | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2021402413](https://steamcommunity.com/sharedfiles/filedetails/?id=2021402413) |
| Deagle \| Rarity | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1827941867](https://steamcommunity.com/sharedfiles/filedetails/?id=1827941867) |
| Deagle \| Royal | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2013774218](https://steamcommunity.com/sharedfiles/filedetails/?id=2013774218) |
| Deagle \| Volcanic | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1987862845](https://steamcommunity.com/sharedfiles/filedetails/?id=1987862845) |
| Desert Eagle - Black Ice | [十年公交男](https://steamcommunity.com/profiles/76561198848049874) | [2607590291](https://steamcommunity.com/sharedfiles/filedetails/?id=2607590291) |
| Desert Eagle - DemonAXiaojie Theme | [猫宫又奈](https://steamcommunity.com/profiles/76561198317270181) | [3473632993](https://steamcommunity.com/sharedfiles/filedetails/?id=3473632993) |
| Desert Eagle - Dragon Glass | [multo](https://steamcommunity.com/profiles/76561199001846248) | [3565185211](https://steamcommunity.com/sharedfiles/filedetails/?id=3565185211) |
| Desert Eagle \| Code Red | [ZaihnY](https://steamcommunity.com/profiles/76561198292912187) | [2705340335](https://steamcommunity.com/sharedfiles/filedetails/?id=2705340335) |
| Desert Eagle \| Fennec Fox | [ZaihnY](https://steamcommunity.com/profiles/76561198292912187) | [2705155283](https://steamcommunity.com/sharedfiles/filedetails/?id=2705155283) |
| Desert Eagle \| Printstream | [ZaihnY](https://steamcommunity.com/profiles/76561198292912187) | [2705308152](https://steamcommunity.com/sharedfiles/filedetails/?id=2705308152) |
| Desert Eagle Retrowave / Synthwave | [Laith](https://steamcommunity.com/profiles/76561198143530292) | [2095594132](https://steamcommunity.com/sharedfiles/filedetails/?id=2095594132) |
| Fade Magnum | [pert](https://steamcommunity.com/profiles/76561198828533745) | [2858361310](https://steamcommunity.com/sharedfiles/filedetails/?id=2858361310) |
| Golden Desert Eagle | [A Simple Pear](https://steamcommunity.com/profiles/76561199023503088) | [3380373401](https://steamcommunity.com/sharedfiles/filedetails/?id=3380373401) |
| Magnum Denia (Wuthering Waves) | [SSSoyorin](https://steamcommunity.com/profiles/76561198068179093) | [3757405260](https://steamcommunity.com/sharedfiles/filedetails/?id=3757405260) |
| Magnum Hatsune Miku 16th Anniversary (Glow) | [鹿目徳門+](https://steamcommunity.com/profiles/76561199446396908) | [3028559765](https://steamcommunity.com/sharedfiles/filedetails/?id=3028559765) |
| Magnum Senko-san (Glow) | [薄雪中意晚莲](https://steamcommunity.com/profiles/76561198868564103) | [2814111195](https://steamcommunity.com/sharedfiles/filedetails/?id=2814111195) |
| Magnum Snow Miku (Dynamic/Glow) | [鹿目徳門+](https://steamcommunity.com/profiles/76561199446396908) | [3288053100](https://steamcommunity.com/sharedfiles/filedetails/?id=3288053100) |
| Magnum Summer (Glow) | [薄雪中意晚莲](https://steamcommunity.com/profiles/76561198868564103) | [2825654306](https://steamcommunity.com/sharedfiles/filedetails/?id=2825654306) |
| Magnum: Not Toy | [Fang Yuan](https://steamcommunity.com/profiles/76561198886766787) | [3618145490](https://steamcommunity.com/sharedfiles/filedetails/?id=3618145490) |
| Neon Magnum (Glow) | [我觉得我会玩狙](https://steamcommunity.com/profiles/76561198859746113) | [3027541381](https://steamcommunity.com/sharedfiles/filedetails/?id=3027541381) |
| Nepgear Desert Eagle (Hyperdimension Neptunia) | [ジャレッド](https://steamcommunity.com/profiles/76561198287332761) | [2829210399](https://steamcommunity.com/sharedfiles/filedetails/?id=2829210399) |

"Desert Eagle Retrowave / Synthwave" is licensed by its author under [CC BY-NC 3.0](https://creativecommons.org/licenses/by-nc/3.0/); it is used here unchanged apart from the technical adaptation above and is never sold for money.

### Fire Axe (15)

| Skin | Author | Workshop |
|------|--------|----------|
| Fireaxe - Acid Blade | [HitSmoker](https://steamcommunity.com/profiles/76561198096066478) | [2379815447](https://steamcommunity.com/sharedfiles/filedetails/?id=2379815447) |
| Fireaxe - Blazing | [Adrenochrome Enjoyer](https://steamcommunity.com/profiles/76561198157133316) | [3289016100](https://steamcommunity.com/sharedfiles/filedetails/?id=3289016100) |
| Fireaxe - Dark and Dirty | [User\_man52](https://steamcommunity.com/profiles/76561199454412221) | [3601126478](https://steamcommunity.com/sharedfiles/filedetails/?id=3601126478) |
| Fireaxe - Honey B. Lovely | [野生带鱼](https://steamcommunity.com/profiles/76561198114035292) | [3386688086](https://steamcommunity.com/sharedfiles/filedetails/?id=3386688086) |
| Fireaxe - Ice Coaled | [宫永野乃花](https://steamcommunity.com/profiles/76561199762218644) | [3465787019](https://steamcommunity.com/sharedfiles/filedetails/?id=3465787019) |
| Fireaxe - Murder Drones Solver | [Maniek King](https://steamcommunity.com/profiles/76561198192216225) | [3482483091](https://steamcommunity.com/sharedfiles/filedetails/?id=3482483091) |
| Fireaxe - Nebula | [Declan](https://steamcommunity.com/profiles/76561198072955615) | [2479358362](https://steamcommunity.com/sharedfiles/filedetails/?id=2479358362) |
| Fireaxe - Nekomiya Hinata | [有鹿来](https://steamcommunity.com/profiles/76561198824737114) | [2969186761](https://steamcommunity.com/sharedfiles/filedetails/?id=2969186761) |
| Fireaxe - Nick's Axe | [Cruzmaker](https://steamcommunity.com/profiles/76561198192442390) | [2722431635](https://steamcommunity.com/sharedfiles/filedetails/?id=2722431635) |
| Fireaxe - Nightmare Foxy | [Markovnick](https://steamcommunity.com/profiles/76561199572801140) | [3373769872](https://steamcommunity.com/sharedfiles/filedetails/?id=3373769872) |
| Fireaxe - NMRIH | [LeHaVo \| Lifelover](https://steamcommunity.com/profiles/76561199015610616) | [2628556383](https://steamcommunity.com/sharedfiles/filedetails/?id=2628556383) |
| Fireaxe - Red and Black | [Alex\_D \#NoWar](https://steamcommunity.com/profiles/76561198012689307) | [524085897](https://steamcommunity.com/sharedfiles/filedetails/?id=524085897) |
| Fireaxe - RGB Blotches | [noahthenova](https://steamcommunity.com/profiles/76561198141428657) | [2969724713](https://steamcommunity.com/sharedfiles/filedetails/?id=2969724713) |
| Fireaxe - Tribal (Dying Light) | [JC Vlad](https://steamcommunity.com/profiles/76561199013613152) | [3776818868](https://steamcommunity.com/sharedfiles/filedetails/?id=3776818868) |
| Fireaxe - Whitetail | [A Simple Pear](https://steamcommunity.com/profiles/76561199023503088) | [3305977656](https://steamcommunity.com/sharedfiles/filedetails/?id=3305977656) |

### Katana (7)

| Skin | Author | Workshop |
|------|--------|----------|
| Katana - Clouds (Glow) | [Laith](https://steamcommunity.com/profiles/76561198143530292) | [2058886315](https://steamcommunity.com/sharedfiles/filedetails/?id=2058886315) |
| Katana - Gawr Gura | [ZeroRofl](https://steamcommunity.com/profiles/76561198036947328) | [2269950390](https://steamcommunity.com/sharedfiles/filedetails/?id=2269950390) |
| Katana - Holographic Rainbow | [Kokkorylien](https://steamcommunity.com/profiles/76561198212071259) | [2863517099](https://steamcommunity.com/sharedfiles/filedetails/?id=2863517099) |
| Katana - Luna's Guard | [groX](https://steamcommunity.com/profiles/76561198252399074) | [3344571453](https://steamcommunity.com/sharedfiles/filedetails/?id=3344571453) |
| Katana - Old | [A Simple Pear](https://steamcommunity.com/profiles/76561199023503088) | [3304391063](https://steamcommunity.com/sharedfiles/filedetails/?id=3304391063) |
| Katana - Sword of the Undead (Glow) | [SherlockHolmes9™](https://steamcommunity.com/profiles/76561198144229031) | [2023972353](https://steamcommunity.com/sharedfiles/filedetails/?id=2023972353) |
| Katana - Teal and Black | [Táiga Rivers](https://steamcommunity.com/profiles/76561198199902353) | [2903220314](https://steamcommunity.com/sharedfiles/filedetails/?id=2903220314) |

### Machete (5)

| Skin | Author | Workshop |
|------|--------|----------|
| Machete - Puro and K (Glow) | [LinjieSAMA](https://steamcommunity.com/profiles/76561199213719086) | [3325822443](https://steamcommunity.com/sharedfiles/filedetails/?id=3325822443) |
| Machete - Sweet Dreams | [Never](https://steamcommunity.com/profiles/76561198226608960) | [2003885703](https://steamcommunity.com/sharedfiles/filedetails/?id=2003885703) |
| Machete - Synthetic Grip | [Lyreck](https://steamcommunity.com/profiles/76561198161511517) | [3006540554](https://steamcommunity.com/sharedfiles/filedetails/?id=3006540554) |
| Machete - Thorax | [ChrYS41i5](https://steamcommunity.com/profiles/76561199075328526) | [2302484331](https://steamcommunity.com/sharedfiles/filedetails/?id=2302484331) |
| Machete - Tribal (Dying Light) | [JC Vlad](https://steamcommunity.com/profiles/76561199013613152) | [3568360966](https://steamcommunity.com/sharedfiles/filedetails/?id=3568360966) |

### Baseball Bat (4)

| Skin | Author | Workshop |
|------|--------|----------|
| Baseball Bat - Circles and Stars | [noahthenova](https://steamcommunity.com/profiles/76561198141428657) | [2466904025](https://steamcommunity.com/sharedfiles/filedetails/?id=2466904025) |
| Baseball Bat - Holographic Rainbow | [Kokkorylien](https://steamcommunity.com/profiles/76561198212071259) | [2863528972](https://steamcommunity.com/sharedfiles/filedetails/?id=2863528972) |
| Baseball Bat - My Melody | [death. by dolls ꔫ](https://steamcommunity.com/profiles/76561199063522016) | [3357469022](https://steamcommunity.com/sharedfiles/filedetails/?id=3357469022) |
| Baseball Bat - Vintage | [A Simple Pear](https://steamcommunity.com/profiles/76561199023503088) | [3302344749](https://steamcommunity.com/sharedfiles/filedetails/?id=3302344749) |

### Cricket Bat (3)

| Skin | Author | Workshop |
|------|--------|----------|
| Cricket Bat - Green and Gold | [Reyes](https://steamcommunity.com/profiles/76561199070651187) | [2425282156](https://steamcommunity.com/sharedfiles/filedetails/?id=2425282156) |
| Cricket Bat - Iron Maiden | [Vilinsecto](https://steamcommunity.com/profiles/76561197971037155) | [2330191700](https://steamcommunity.com/sharedfiles/filedetails/?id=2330191700) |
| Cricket Bat - Team | [A Simple Pear](https://steamcommunity.com/profiles/76561199023503088) | [3303218686](https://steamcommunity.com/sharedfiles/filedetails/?id=3303218686) |

### Electric Guitar (6)

| Skin | Author | Workshop |
|------|--------|----------|
| Electric Guitar - Billie's Blue | [\#็](https://steamcommunity.com/profiles/76561198804941539) | [3330591105](https://steamcommunity.com/sharedfiles/filedetails/?id=3330591105) |
| Electric Guitar - Dokibird | [PAGEANT](https://steamcommunity.com/profiles/76561198060504044) | [3277167545](https://steamcommunity.com/sharedfiles/filedetails/?id=3277167545) |
| Electric Guitar - Floral Pattern | [noahthenova](https://steamcommunity.com/profiles/76561198141428657) | [2926720532](https://steamcommunity.com/sharedfiles/filedetails/?id=2926720532) |
| Electric Guitar - Lovely Heart | [Never](https://steamcommunity.com/profiles/76561198226608960) | [1993366463](https://steamcommunity.com/sharedfiles/filedetails/?id=1993366463) |
| Electric Guitar - Pikachu | [Azhe](https://steamcommunity.com/profiles/76561198980027610) | [2457923173](https://steamcommunity.com/sharedfiles/filedetails/?id=2457923173) |
| Electric Guitar - Scott's Rickenbacker | [Nicky Grimes](https://steamcommunity.com/profiles/76561198377797621) | [2858127316](https://steamcommunity.com/sharedfiles/filedetails/?id=2858127316) |

### Crowbar (2)

| Skin | Author | Workshop |
|------|--------|----------|
| Crowbar - Pink | [Athena ˚\*.](https://steamcommunity.com/profiles/76561198031922253) | [2047772946](https://steamcommunity.com/sharedfiles/filedetails/?id=2047772946) |
| Crowbar - Rainbow | [Athena ˚\*.](https://steamcommunity.com/profiles/76561198031922253) | [2046555366](https://steamcommunity.com/sharedfiles/filedetails/?id=2046555366) |

### Golf Club (2)

| Skin | Author | Workshop |
|------|--------|----------|
| Golf Club - Holographic Rainbow | [Kokkorylien](https://steamcommunity.com/profiles/76561198212071259) | [2863498654](https://steamcommunity.com/sharedfiles/filedetails/?id=2863498654) |
| Golf Club - Pro | [A Simple Pear](https://steamcommunity.com/profiles/76561199023503088) | [3303726756](https://steamcommunity.com/sharedfiles/filedetails/?id=3303726756) |

### Frying Pan (1)

| Skin | Author | Workshop |
|------|--------|----------|
| Frying Pan - Momo Momone | [Mayday\_우타네](https://steamcommunity.com/profiles/76561198156304560) | [2630140015](https://steamcommunity.com/sharedfiles/filedetails/?id=2630140015) |

### Authors

[《Happi Doggo》](https://steamcommunity.com/profiles/76561198804859540) (3) · [\#็](https://steamcommunity.com/profiles/76561198804941539) (1) · [A Simple Pear](https://steamcommunity.com/profiles/76561199023503088) (6) · [ABLACK-A.S](https://steamcommunity.com/profiles/76561199201139601) (1) · [Adrenochrome Enjoyer](https://steamcommunity.com/profiles/76561198157133316) (1) · [Alex\_D \#NoWar](https://steamcommunity.com/profiles/76561198012689307) (2) · [Amel](https://steamcommunity.com/profiles/76561198065445389) (1) · [Athena ˚\*.](https://steamcommunity.com/profiles/76561198031922253) (2) · [Azhe](https://steamcommunity.com/profiles/76561198980027610) (1) · [BATTLE NO.1](https://steamcommunity.com/profiles/76561199147992281) (4) · [bliss](https://steamcommunity.com/profiles/76561198862737859) (5) · [Bonnie](https://steamcommunity.com/profiles/76561198073812490) (15) · [ChrYS41i5](https://steamcommunity.com/profiles/76561199075328526) (1) · [Cruzmaker](https://steamcommunity.com/profiles/76561198192442390) (1) · [death. by dolls ꔫ](https://steamcommunity.com/profiles/76561199063522016) (2) · [Declan](https://steamcommunity.com/profiles/76561198072955615) (1) · [Drunken Irishman](https://steamcommunity.com/profiles/76561198067821017) (3) · [Fang Yuan](https://steamcommunity.com/profiles/76561198886766787) (1) · [Ga(z)imon](https://steamcommunity.com/profiles/76561198088730923) (1) · [groX](https://steamcommunity.com/profiles/76561198252399074) (1) · [HardToImaginePrideEverChanging](https://steamcommunity.com/profiles/76561198449238509) (5) · [HitSmoker](https://steamcommunity.com/profiles/76561198096066478) (3) · [igames](https://steamcommunity.com/profiles/76561198407554343) (22) · [izida1005](https://steamcommunity.com/profiles/76561199608610386) (1) · [Jamar2211](https://steamcommunity.com/profiles/76561198886170298) (1) · [JC Vlad](https://steamcommunity.com/profiles/76561199013613152) (2) · [kklkl](https://steamcommunity.com/profiles/76561199496633553) (1) · [Kokkorylien](https://steamcommunity.com/profiles/76561198212071259) (4) · [konkeso](https://steamcommunity.com/profiles/76561198970880706) (1) · [KoyomiLi](https://steamcommunity.com/profiles/76561198200063591) (1) · [kΛmesan](https://steamcommunity.com/profiles/76561198271003114) (1) · [Laith](https://steamcommunity.com/profiles/76561198143530292) (2) · [LeHaVo \| Lifelover](https://steamcommunity.com/profiles/76561199015610616) (1) · [LinjieSAMA](https://steamcommunity.com/profiles/76561199213719086) (1) · [Lyreck](https://steamcommunity.com/profiles/76561198161511517) (2) · [Maniek King](https://steamcommunity.com/profiles/76561198192216225) (1) · [Markovnick](https://steamcommunity.com/profiles/76561199572801140) (1) · [Mayday\_우타네](https://steamcommunity.com/profiles/76561198156304560) (1) · [multo](https://steamcommunity.com/profiles/76561199001846248) (2) · [Nagasaki Soyo](https://steamcommunity.com/profiles/76561198979336170) (3) · [Never](https://steamcommunity.com/profiles/76561198226608960) (18) · [Nicky Grimes](https://steamcommunity.com/profiles/76561198377797621) (1) · [noahthenova](https://steamcommunity.com/profiles/76561198141428657) (3) · [Nuj02](https://steamcommunity.com/profiles/76561199229538843) (1) · [PAGEANT](https://steamcommunity.com/profiles/76561198060504044) (1) · [pert](https://steamcommunity.com/profiles/76561198828533745) (1) · [PurpleLichious](https://steamcommunity.com/profiles/76561198992841006) (1) · [red apple](https://steamcommunity.com/profiles/76561198373741233) (1) · [reprol](https://steamcommunity.com/profiles/76561199195148539) (1) · [Reyes](https://steamcommunity.com/profiles/76561199070651187) (1) · [Rumia](https://steamcommunity.com/profiles/76561199069540290) (2) · [Sa-Daniels](https://steamcommunity.com/profiles/76561198043631800) (2) · [SherlockHolmes9™](https://steamcommunity.com/profiles/76561198144229031) (4) · [Spiralt](https://steamcommunity.com/profiles/76561198125045326) (1) · [SSSoyorin](https://steamcommunity.com/profiles/76561198068179093) (1) · [Starlight](https://steamcommunity.com/profiles/76561198812747106) (3) · [Táiga Rivers](https://steamcommunity.com/profiles/76561198199902353) (1) · [TheOneChicken](https://steamcommunity.com/profiles/76561198126786969) (1) · [User\_man52](https://steamcommunity.com/profiles/76561199454412221) (1) · [Vampiturra (⌐■\_■)](https://steamcommunity.com/profiles/76561199222348819) (1) · [Vilinsecto](https://steamcommunity.com/profiles/76561197971037155) (1) · [Xavier](https://steamcommunity.com/profiles/76561198185766111) (1) · [ZaihnY](https://steamcommunity.com/profiles/76561198292912187) (3) · [ZeroRofl](https://steamcommunity.com/profiles/76561198036947328) (1) · [ジャレッド](https://steamcommunity.com/profiles/76561198287332761) (2) · [一只柒](https://steamcommunity.com/profiles/76561199523448244) (1) · [十年公交男](https://steamcommunity.com/profiles/76561198848049874) (4) · [卡卡™](https://steamcommunity.com/profiles/76561198979410407) (1) · [卤香牛肉面](https://steamcommunity.com/profiles/76561198327025816) (1) · [叫声爸爸救你](https://steamcommunity.com/profiles/76561198842020028) (1) · [如群星般Blossom\_AID](https://steamcommunity.com/profiles/76561198118821360) (2) · [宫永野乃花](https://steamcommunity.com/profiles/76561199762218644) (1) · [我觉得我会玩狙](https://steamcommunity.com/profiles/76561198859746113) (1) · [星跃迁](https://steamcommunity.com/profiles/76561198450183507) (1) · [有鹿来](https://steamcommunity.com/profiles/76561198824737114) (3) · [比宇宙更远的地方](https://steamcommunity.com/profiles/76561198973812143) (1) · [猫宫又奈](https://steamcommunity.com/profiles/76561198317270181) (1) · [蕾米莉亞親衛隊](https://steamcommunity.com/profiles/76561198302632895) (1) · [薄雪中意晚莲](https://steamcommunity.com/profiles/76561198868564103) (5) · [西南老表](https://steamcommunity.com/profiles/76561199433838559) (1) · [这并不好笑](https://steamcommunity.com/profiles/76561198370506425) (1) · [野生带鱼](https://steamcommunity.com/profiles/76561198114035292) (1) · [鹿目徳門+](https://steamcommunity.com/profiles/76561199446396908) (6)
