"""Export an edited aurora.blend without regenerating or overwriting artist edits.

blender -b assets/aurora/aurora.blend --python assets/aurora/export-aurora.py
"""
import bpy
import bmesh
import hashlib
import json
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
root = bpy.data.objects.get('AURORA')
if root is None:
    raise RuntimeError('Open the AURORA source .blend before exporting')
required = ['Wing_Fore_Port', 'Wing_Fore_Starboard', 'Wing_Aft_Port', 'Wing_Aft_Starboard',
            'Canopy_Single', 'Nacelle_Port', 'Nacelle_Starboard', 'Cockpit_View',
            'Boarding_Exit', 'Chase_Target', 'Exhaust_Port', 'Exhaust_Starboard']
for name in required:
    assert bpy.data.objects.get(name), f'Missing required part or mount: {name}'

non_manifold_edges = 0
deps = bpy.context.evaluated_depsgraph_get()
for ob in root.children_recursive:
    if ob.type != 'MESH':
        continue
    evaluated = ob.evaluated_get(deps)
    data = evaluated.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(data)
    non_manifold_edges += sum(not edge.is_manifold for edge in bm.edges)
    bm.free()
    evaluated.to_mesh_clear()
assert non_manifold_edges == 0, f'Non-manifold mesh edges: {non_manifold_edges}'

bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for ob in root.children_recursive:
    ob.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=str(HERE/'aurora.glb'), export_format='GLB', use_selection=True,
    export_apply=True, export_extras=True, export_animations=False,
    export_cameras=False, export_lights=False, export_yup=True,
    export_draco_mesh_compression_enable=False,
)
blob = (HERE/'aurora.glb').read_bytes()
length, kind = struct.unpack_from('<II', blob, 12)
doc = json.loads(blob[20:20+length])
triangles = sum(doc['accessors'][p['indices']]['count']//3
                for mesh in doc['meshes'] for p in mesh['primitives'])
report = {
    'blender_version': bpy.app.version_string,
    'generator': 'assets/aurora/build-aurora.py',
    'exporter': 'assets/aurora/export-aurora.py',
    'meters_per_game_unit': 10, 'scale_to_game': .1,
    'simulation_landing_datum_m': 6.1,
    'nominal_dimensions_m': {'length': 18, 'aft_wingspan': 18.6, 'fore_wingspan': 12.6},
    'triangles': triangles,
    'mesh_primitives': sum(len(mesh['primitives']) for mesh in doc['meshes']),
    'materials': len(doc['materials']), 'textures': len(doc.get('textures', [])),
    'non_manifold_edges': non_manifold_edges,
    'glb_bytes': len(blob), 'glb_sha256': hashlib.sha256(blob).hexdigest(),
    'source_blend_sha256': hashlib.sha256((HERE/'aurora.blend').read_bytes()).hexdigest(),
    'wing_nodes': [n['name'] for n in doc['nodes'] if n.get('extras', {}).get('part') == 'wing'],
    'exhaust_nodes': [n['name'] for n in doc['nodes'] if n.get('extras', {}).get('part') == 'exhaust'],
    'ground_contacts': [n['name'] for n in doc['nodes'] if n.get('extras', {}).get('part') == 'ground_contact'],
}
assert len(report['wing_nodes']) == 4 and len(report['exhaust_nodes']) == 2
assert triangles < 12000 and len(blob) < 750000
(HERE/'asset-report.json').write_text(json.dumps(report, indent=2)+'\n')
print('AURORA_EXPORT', json.dumps(report))
