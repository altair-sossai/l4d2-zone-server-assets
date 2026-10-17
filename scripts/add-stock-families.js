#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const VPK_FOLDERS = ['update', 'left4dead2_dlc3', 'left4dead2_dlc2', 'left4dead2_dlc1', 'left4dead2'];

function usage() {
    console.error('usage: node scripts/add-stock-families.js <game folder> <weapon_skins.cfg> [check]');
    console.error('  <game folder>      folder that contains left4dead2/ and update/ (e.g. "C:/Program Files (x86)/Steam/steamapps/common/Left 4 Dead 2")');
    console.error('  <weapon_skins.cfg> addons/sourcemod/configs/weapon_skins.cfg of the l4d2-zone-server repository');
    console.error('  check              only print what would change');
    process.exit(1);
}

function readCString(buffer, offset) {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) {
        end++;
    }
    return { text: buffer.toString('latin1', offset, end), next: end + 1 };
}

function openVpk(dirFile) {
    const dir = fs.readFileSync(dirFile);
    if (dir.readUInt32LE(0) !== 0x55aa1234) {
        throw new Error(`${dirFile} is not a VPK directory`);
    }

    const version = dir.readUInt32LE(4);
    const treeSize = dir.readUInt32LE(8);
    const headerSize = version === 2 ? 28 : 12;
    const entries = new Map();
    let offset = headerSize;

    for (;;) {
        const extension = readCString(dir, offset);
        offset = extension.next;
        if (!extension.text) {
            break;
        }

        for (;;) {
            const folder = readCString(dir, offset);
            offset = folder.next;
            if (!folder.text) {
                break;
            }

            for (;;) {
                const name = readCString(dir, offset);
                offset = name.next;
                if (!name.text) {
                    break;
                }

                const preload = dir.readUInt16LE(offset + 4);
                const entry = {
                    archive: dir.readUInt16LE(offset + 6),
                    offset: dir.readUInt32LE(offset + 8),
                    length: dir.readUInt32LE(offset + 12),
                    preloadStart: offset + 18,
                    preload
                };
                offset += 18 + preload;

                const full = (folder.text === ' ' ? '' : `${folder.text}/`) + `${name.text}.${extension.text}`;
                entries.set(full.toLowerCase(), entry);
            }
        }
    }

    const dataStart = headerSize + treeSize;

    return {
        has: (file) => entries.has(file.toLowerCase()),
        read: (file) => {
            const entry = entries.get(file.toLowerCase());
            const parts = [dir.subarray(entry.preloadStart, entry.preloadStart + entry.preload)];
            if (entry.length > 0) {
                if (entry.archive === 0x7fff) {
                    parts.push(dir.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.length));
                } else {
                    const archive = dirFile.replace(/_dir\.vpk$/i, `_${String(entry.archive).padStart(3, '0')}.vpk`);
                    const fd = fs.openSync(archive, 'r');
                    const data = Buffer.alloc(entry.length);
                    fs.readSync(fd, data, 0, entry.length, entry.offset);
                    fs.closeSync(fd);
                    parts.push(data);
                }
            }
            return Buffer.concat(parts);
        }
    };
}

function readStockModel(gameFolder, file) {
    for (const folder of VPK_FOLDERS) {
        const dirFile = path.join(gameFolder, folder, 'pak01_dir.vpk');
        if (!fs.existsSync(dirFile)) {
            continue;
        }

        const vpk = openVpk(dirFile);
        if (vpk.has(file)) {
            return { data: vpk.read(file), source: folder };
        }
    }

    throw new Error(`${file} not found in the game VPKs`);
}

function parseModel(data) {
    const header = {
        length: data.readInt32LE(76),
        numTextures: data.readInt32LE(204),
        textureIndex: data.readInt32LE(208),
        numCdTextures: data.readInt32LE(212),
        cdTextureIndex: data.readInt32LE(216),
        numSkinRef: data.readInt32LE(220),
        numSkinFamilies: data.readInt32LE(224),
        skinIndex: data.readInt32LE(228)
    };

    const textures = [];
    for (let i = 0; i < header.numTextures; i++) {
        const base = header.textureIndex + i * 64;
        textures.push(readCString(data, base + data.readInt32LE(base)).text);
    }

    const cdTextures = [];
    for (let i = 0; i < header.numCdTextures; i++) {
        cdTextures.push(readCString(data, data.readInt32LE(header.cdTextureIndex + i * 4)).text);
    }

    const families = [];
    for (let f = 0; f < header.numSkinFamilies; f++) {
        const row = [];
        for (let r = 0; r < header.numSkinRef; r++) {
            row.push(data.readInt16LE(header.skinIndex + (f * header.numSkinRef + r) * 2));
        }
        families.push(row);
    }

    return { header, textures, cdTextures, families };
}

function align(buffer) {
    const padding = (4 - (buffer.length % 4)) % 4;
    return padding ? Buffer.concat([buffer, Buffer.alloc(padding)]) : buffer;
}

function hasStockFamilies(combined) {
    return combined.cdTextures.length > 1;
}

function addStockFamilies(combinedData, stockData) {
    const combined = parseModel(combinedData);
    const stock = parseModel(stockData);

    if (combined.header.numSkinRef !== stock.header.numSkinRef) {
        throw new Error(`skin reference count differs: combined ${combined.header.numSkinRef}, stock ${stock.header.numSkinRef}`);
    }

    let out = align(Buffer.from(combinedData));

    const textureNames = [...combined.textures, ...stock.textures];
    const textureArrayStart = out.length;
    const textureArray = Buffer.alloc(textureNames.length * 64);
    for (let i = 0; i < combined.header.numTextures; i++) {
        combinedData.copy(textureArray, i * 64, combined.header.textureIndex + i * 64, combined.header.textureIndex + (i + 1) * 64);
    }
    out = Buffer.concat([out, textureArray]);

    const cdNames = [...combined.cdTextures, ...stock.cdTextures];
    const cdArrayStart = out.length;
    out = Buffer.concat([out, Buffer.alloc(cdNames.length * 4)]);

    const strings = [];
    let cursor = out.length;
    const offsetOf = (name) => {
        const at = cursor;
        strings.push(Buffer.from(`${name}\0`, 'latin1'));
        cursor += name.length + 1;
        return at;
    };
    const textureNameOffsets = textureNames.map(offsetOf);
    const cdNameOffsets = cdNames.map(offsetOf);
    out = align(Buffer.concat([out, ...strings]));

    for (let i = 0; i < textureNames.length; i++) {
        const base = textureArrayStart + i * 64;
        out.writeInt32LE(textureNameOffsets[i] - base, base);
    }
    for (let i = 0; i < cdNames.length; i++) {
        out.writeInt32LE(cdNameOffsets[i], cdArrayStart + i * 4);
    }

    const families = [
        ...stock.families.map((row) => row.map((texture) => texture + combined.header.numTextures)),
        ...combined.families
    ];
    const skinTableStart = out.length;
    const skinTable = Buffer.alloc(families.length * combined.header.numSkinRef * 2);
    families.forEach((row, f) => row.forEach((texture, r) => skinTable.writeInt16LE(texture, (f * combined.header.numSkinRef + r) * 2)));
    out = align(Buffer.concat([out, skinTable]));

    out.writeInt32LE(textureNames.length, 204);
    out.writeInt32LE(textureArrayStart, 208);
    out.writeInt32LE(cdNames.length, 212);
    out.writeInt32LE(cdArrayStart, 216);
    out.writeInt32LE(families.length, 224);
    out.writeInt32LE(skinTableStart, 228);
    out.writeInt32LE(out.length, 76);

    return { data: out, stockFamilies: stock.families.length };
}

function readWeapons(cfgFile) {
    const text = fs.readFileSync(cfgFile, 'latin1');
    const weapons = [];
    const pattern = /"(weapon_[a-z0-9_]+)"\s*\{([^{}]*)\}/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const body = match[2];
        const value = (key) => {
            const found = new RegExp(`"${key}"\\s*"([^"]+)"`).exec(body);
            return found ? found[1] : null;
        };
        if (value('view_model') && value('default_view_model')) {
            weapons.push({
                weapon: match[1],
                models: [
                    { combined: value('view_model'), stock: value('default_view_model') },
                    { combined: value('world_model'), stock: value('default_world_model') }
                ]
            });
        }
    }
    return weapons;
}

function main() {
    const [gameFolder, cfgFile, mode] = process.argv.slice(2);
    if (!gameFolder || !cfgFile) {
        usage();
    }

    const check = mode === 'check';
    const repo = path.resolve(__dirname, '..');

    for (const weapon of readWeapons(cfgFile)) {
        const counts = new Set();
        for (const model of weapon.models) {
            const file = path.join(repo, model.combined);
            const combinedData = fs.readFileSync(file);
            const combined = parseModel(combinedData);
            const stock = readStockModel(gameFolder, model.stock);
            counts.add(parseModel(stock.data).families.length);

            if (hasStockFamilies(combined)) {
                console.log(`${model.combined}: already has the stock families`);
                continue;
            }

            const result = addStockFamilies(combinedData, stock.data);
            console.log(`${model.combined}: ${result.stockFamilies} stock families from ${stock.source}/${model.stock} + ${combined.header.numSkinFamilies} skins (${combinedData.length} -> ${result.data.length} bytes)`);

            if (!check) {
                fs.writeFileSync(file, result.data);
            }
        }

        if (counts.size !== 1) {
            throw new Error(`${weapon.weapon}: the stock view and world models have a different number of skin families`);
        }

        console.log(`${weapon.weapon}: stock_skins ${[...counts][0]}, so its skins start at family ${[...counts][0]}`);
    }
}

if (require.main === module) {
    main();
}

module.exports = { openVpk, parseModel, addStockFamilies, readStockModel };
