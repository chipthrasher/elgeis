// Replaces every polygon in layers/political/ with the output of import_pdn.py.
// Nations (ent_ files) are left alone. See README.md.
//
// Usage: node scripts/pdn-import/write-layer.ts regions.json [layers/political]

import fs from 'node:fs'
import path from 'node:path'
import { formatJson } from '../../shared/format.ts'
import { idPrefixFor, newId, type Geometry } from '../../shared/layer.ts'

const [input, dir = 'layers/political'] = process.argv.slice(2)
const regions: { entity: string | null, geometry: Geometry }[] = JSON.parse(fs.readFileSync(input, 'utf8'))

for (const name of fs.readdirSync(dir)) if (name.startsWith('pol_')) fs.rmSync(path.join(dir, name))
for (const { entity, geometry } of regions) {
    const properties: Record<string, string> = { notes: 'Traced from flyingmappdn.pdn' }
    if (entity) properties.entity = entity
    const object = { type: 'Feature', id: newId(idPrefixFor(geometry)), properties, geometry }
    fs.writeFileSync(path.join(dir, object.id + '.json'), formatJson(object))
}
console.log(`Wrote ${regions.length} polygons to ${dir}`)
