// Builds the layer folders in layers/ into static JSON for the map:
//
//   layers/<id>/layer.json      the layer's manifest (name, dimension, schema)
//   layers/<id>/<object>.json   one GeoJSON Feature per object
//
// becomes
//
//   dist/layers/index.json      every layer's manifest
//   dist/layers/<id>.json       a FeatureCollection of the layer's visible objects
//
// Everything is validated first, and nothing is written if anything is invalid.
//
// Usage: node scripts/build-layers.ts [layers dir] [output dir]

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { Layer, objectSchema, referencedIds, type LayerObject } from '../shared/layer.ts'

export interface LayerData {
    layer: Layer
    objects: LayerObject[]
}

const MANIFEST = 'layer.json'

// Read and validate every layer in a directory. Throws one error listing every
// problem found.
export function readLayers(dir: string): LayerData[] {
    const errors: string[] = []
    const fail = (file: string, message: string) => errors.push(`${path.relative(process.cwd(), file)}: ${message}`)

    function parse<T>(schema: z.ZodType<T>, file: string): T | undefined {
        let json
        try {
            json = JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch (e) {
            fail(file, (e as Error).message)
            return
        }
        const result = schema.safeParse(json)
        if (!result.success) fail(file, '\n' + z.prettifyError(result.error))
        return result.data
    }

    const layers: LayerData[] = []
    const folders = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
    for (const folder of folders) {
        const manifestFile = path.join(dir, folder, MANIFEST)
        const layer = parse(Layer, manifestFile)
        if (!layer) continue
        if (layer.id !== folder) fail(manifestFile, `ID "${layer.id}" doesn't match its folder "${folder}"`)

        const schema = objectSchema(layer)
        const objects: LayerObject[] = []
        for (const name of fs.readdirSync(path.join(dir, folder)).sort()) {
            if (name === MANIFEST || !name.endsWith('.json')) continue
            const file = path.join(dir, folder, name)
            const object = parse(schema, file)
            if (!object) continue
            if (name !== object.id + '.json') fail(file, `File name doesn't match ID "${object.id}"`)
            objects.push(object)
        }
        layers.push({ layer, objects })
    }

    // IDs are unique across all layers, and references can point into any layer.
    const ids = new Set<string>()
    for (const { layer, objects } of layers) {
        for (const object of objects) {
            if (ids.has(object.id)) fail(path.join(dir, layer.id, object.id + '.json'), 'Duplicate ID')
            ids.add(object.id)
        }
    }
    for (const { layer, objects } of layers) {
        for (const object of objects) {
            for (const ref of referencedIds(layer, object)) {
                if (!ids.has(ref)) fail(path.join(dir, layer.id, object.id + '.json'), `References missing object "${ref}"`)
            }
        }
    }

    if (errors.length) throw new Error(`Invalid layer data:\n${errors.join('\n')}`)
    return layers
}

export function buildLayers(layersDir: string, outDir: string): LayerData[] {
    const layers = readLayers(layersDir)
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(outDir, { recursive: true })

    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(layers.map(l => l.layer)))
    for (const { layer, objects } of layers) {
        const features = objects.filter(o => !o.properties.hidden)
        fs.writeFileSync(path.join(outDir, layer.id + '.json'), JSON.stringify({ type: 'FeatureCollection', features }))
    }
    return layers
}

if (import.meta.main) {
    const [layersDir = 'layers', outDir = 'dist/layers'] = process.argv.slice(2)
    try {
        const layers = buildLayers(layersDir, outDir)
        const count = layers.reduce((n, l) => n + l.objects.length, 0)
        console.log(`Built ${layers.length} layers (${count} objects) into ${outDir}`)
    } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
    }
}
