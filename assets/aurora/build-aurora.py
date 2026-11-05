"""Build the editable AURORA source and the exact GLB used by the game.

Run from anywhere: blender -b --python assets/aurora/build-aurora.py
Blender coordinates: X starboard, Y forward, Z up; metres; feet at Z=0.
glTF export maps these to X starboard, Y up, Z aft, nose Z=-9.
"""
import bpy
import bmesh
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):
    bpy.data.materials.remove(data)

def material(name, rgb, metal=0, rough=.5, emission=None):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*rgb, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

ivory = material('Ceramic_Ivory', (.67, .70, .67), .24, .46)
dark = material('Structure_Charcoal', (.025, .043, .055), .55, .42)
copper = material('Leading_Edge_Copper', (.55, .245, .105), .58, .4)
glass = material('Canopy_Smoked_Teal', (.018, .12, .145), .34, .18)
cyan = material('Exhaust_Cyan', (.12, .70, .82), .15, .28, 2)
rubber = material('Foot_Pads', (.014, .022, .026), .05, .8)
root = bpy.data.objects.new('AURORA', None)
bpy.context.collection.objects.link(root)
root['asset'] = 'AURORA'
root['concept_revision'] = '01'
root['units'] = 'metres; ground datum at feet'

def point(x, s, h):
    return (x, 9-s, h)

def empty(name, xyz, parent=root, **props):
    ob = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    ob.location = xyz
    for key, value in props.items():
        ob[key] = value
    return ob

def mesh(name, vertices, faces, mat, parent=root, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    data.materials.append(mat)
    if bevel:
        mod = ob.modifiers.new('Small manufacturable edge bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
    return ob

def box(name, xyz, size, mat, parent=root, bevel=.035):
    x,y,z = xyz
    a,b,c = (d/2 for d in size)
    vertices = [(x+i*a,y+j*b,z+k*c) for k in (-1,1) for j in (-1,1) for i in (-1,1)]
    faces = [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
    return mesh(name,vertices,faces,mat,parent,bevel)

def loft(name, stations, mat, bevel=0):
    vertices=[]
    for s,w,top,bottom in stations:
        shoulder=bottom+(top-bottom)*.72
        cheek=bottom+(top-bottom)*.22
        vertices += [point(x,s,h) for x,h in [(-.6*w,top),(.6*w,top),(w,shoulder),(.9*w,cheek),(.45*w,bottom),(-.45*w,bottom),(-.9*w,cheek),(-w,shoulder)]]
    faces=[tuple(reversed(range(8))),tuple(range(len(vertices)-8,len(vertices)))]
    for i in range(len(stations)-1):
        for j in range(8):
            a=i*8+j;b=i*8+(j+1)%8
            faces.append((a,b,b+8,a+8))
    return mesh(name,vertices,faces,mat,bevel=bevel)

loft('Fuselage_Wedge',[(0,.035,2.5,2.46),(2.8,.72,2.96,1.8),(5.3,1.3,3.08,1.4),(8.8,2,2.98,1.2),(12.8,1.8,2.8,1.32),(16.5,1.15,2.48,1.55),(18,.3,2.22,1.86)],ivory,.025)
loft('Belly_Keel',[(3,.32,1.75,1.65),(8,1.25,1.28,1.12),(12.8,1.2,1.39,1.18),(16.5,.5,1.62,1.48)],dark)
loft('Canopy_Frame',[(2.8,.28,3.13,2.88),(4.2,.66,3.98,3.0),(6.7,.69,3.94,3.01),(7.7,.51,3.12,2.92)],dark,.02)
loft('Canopy_Single',[(2.98,.23,3.15,3.06),(4.24,.58,3.94,3.1),(6.64,.61,3.9,3.1),(7.48,.46,3.16,3.06)],glass,.012)

def wing(name, outline, thickness):
    n=len(outline)
    vertices=[point(x,s,h+thickness/2) for x,s,h in outline]+[point(x,s,h-thickness/2) for x,s,h in outline]
    faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    ob=mesh(name,vertices,faces,ivory,bevel=.018)
    ob['part']='wing'
    ob['pair']='fore' if 'Fore' in name else 'aft'
    ob['side']='port' if 'Port' in name else 'starboard'
    return ob

trim_parts=[]
structure_parts=[]
detail_parts=[]
for sign,side in [(-1,'Port'),(1,'Starboard')]:
    fore=[(sign*1.7,6.4,3.4),(sign*6.3,5.7,4.05),(sign*6.12,6.5,4.05),(sign*1.9,9.3,3.4)]
    aft=[(sign*1.75,11,2.0),(sign*9.3,14.4,1.96),(sign*9.02,15.2,1.94),(sign*2,14.6,2.0)]
    wing('Wing_Fore_'+side,fore,.18)
    wing('Wing_Aft_'+side,aft,.22)
    for pair,points in [('Fore',fore),('Aft',aft)]:
        a,b=points[:2]
        strip=[a,b,(b[0],b[1]+.13,b[2]+.012),(a[0],a[1]+.13,a[2]+.012)]
        n=4;verts=[point(x,s,h+(.105 if pair=='Fore' else .125)) for x,s,h in strip]
        # Thin copper strips are solid bevel-free plates, not coincident opaque layers.
        verts += [(x,y,z-.025) for x,y,z in verts]
        trim_parts.append(mesh('Edge_'+pair+'_'+side,verts,[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],copper))
    structure_parts.append(box('Root_Fore_'+side,point(sign*1.72,7.85,3.12),(.34,2.85,.65),dark))
    structure_parts.append(box('Root_Aft_'+side,point(sign*1.85,12.7,2.05),(.32,3.6,.5),dark))
    # Closed front cap, open-looking inset ring at the aft end only.
    x=sign*1.8
    stations=[(13.35,.45,2.4,1.05),(13.65,.64,2.5,1.0),(17.7,.64,2.42,1.0),(17.94,.49,2.18,1.2)]
    ob=loft('Nacelle_'+side,stations,dark,.035)
    for v in ob.data.vertices:v.co.x += x
    ob['part']='main_engine'
    detail_parts.append(box('Nacelle_Cap_'+side,point(x,15.2,2.49),(1.04,2.8,.14),ivory))
    trim_parts.append(box('Nacelle_Stripe_'+side,point(x,15.2,2.58),(.09,2.7,.035),copper,bevel=0))
    bpy.ops.mesh.primitive_torus_add(major_radius=.43,minor_radius=.085,major_segments=16,minor_segments=6,location=point(x,17.96,1.7),rotation=(math.pi/2,0,0))
    ring=bpy.context.object;ring.name='Nozzle_Ring_'+side;ring.parent=root;ring.data.materials.append(dark)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.35,depth=.035,location=point(x,17.98,1.7),rotation=(math.pi/2,0,0))
    lens=bpy.context.object;lens.name='Nozzle_Lens_'+side;lens.parent=root;lens.data.materials.append(cyan)
    empty('Exhaust_'+side,point(x,18.02,1.7),part='exhaust')
    # Independent telescope roots let the game retract legs without changing the hull.
    for station,label in [(7.9,'Fore'),(13.1,'Aft')]:
        gear=empty('Gear_'+label+'_'+side,point(sign*1.75,station,1.5),part='landing_gear')
        box('Strut_'+label+'_'+side,(0,0,-.65),(.14,.17,1.3),dark,gear,.02)
        box('Pad_'+label+'_'+side,(0,0,-1.43),(.68,.85,.14),rubber,gear,.03)
        empty('Contact_'+label+'_'+side,(0,0,-1.5),gear,part='ground_contact')

# A clear boarding gap between the longitudinal wing roots, on the port side.
box('Port_Boarding_Hatch',point(-1.95,9.9,2.08),(.1,1.0,1.72),dark,bevel=.025)
trim_parts.append(box('Hatch_Upper_Marker',point(-2.02,9.9,2.96),(.035,1.02,.055),copper,bevel=0))
steps=empty('Boarding_Steps',point(-1.8,9.9,1.2),part='boarding_steps')
for i in range(3):
    box('Step_'+str(i),(-.35-i*.35,0,-.28-i*.28),(.40,1.1,.10),dark,steps,.015)
empty('Cockpit_View',point(0,5.5,3.68),part='camera')
empty('Chase_Target',point(0,9,2.35),part='camera_target')
empty('Boarding_Exit',point(-3.25,9.9,1.8),part='exit')

def join_parts(parts,name):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:ob.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    bpy.context.object.name=name

join_parts(trim_parts,'Copper_Accents')
join_parts(structure_parts,'Wing_Root_Joints')
join_parts(detail_parts,'Nacelle_Armor')
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1
scene.world.color=(.15,.15,.15)
scene['authoring']='Procedurally authored and exported in Blender 4.3; editable mesh parts and materials retained.'
scene['concept']='concepts/aurora/originals/aurora-v01-reference-sheet.png'

# Pack the actual final concept into the source file; exclude it from runtime export.
reference=bpy.data.images.load(str(REPO/'concepts/aurora/originals/aurora-v01-reference-sheet.png'))
reference.pack()
ref=bpy.data.objects.new('Concept_Sheet_non_export',None)
bpy.context.collection.objects.link(ref)
ref.empty_display_type='IMAGE'
ref.data=reference
ref.location=(22,0,0)
ref.empty_display_size=18
ref.hide_render=True

for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=27
        area.spaces.active.region_3d.view_location=(0,0,2)
        area.spaces.active.clip_end=500

bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'aurora.blend'),compress=True)
import runpy
runpy.run_path(str(HERE/'export-aurora.py'))
