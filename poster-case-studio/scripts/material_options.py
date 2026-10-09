"""Create low-resolution material-use previews from approved images and cutouts.
Does not segment images or generate art. Source inputs must already be reviewed.
"""
import argparse,json,math
from pathlib import Path
from PIL import Image,ImageFilter,ImageOps

def load(path):
    with Image.open(path) as image:return ImageOps.exif_transpose(image).convert('RGBA')

def fit(image,w,h):
    return ImageOps.contain(image,(max(1,int(w)),max(1,int(h))),Image.Resampling.LANCZOS)

def place(canvas,image,x,y):
    canvas.alpha_composite(image,(int(x),int(y)))

def create(source_paths,cutout_paths,out,ratio='3:4',gap=16,max_edge=480):
    ratios={'3:4':(3,4),'2:3':(2,3),'4:5':(4,5)}
    a,b=ratios[ratio];w=round(max_edge*a/b);h=max_edge
    out.mkdir(parents=True,exist_ok=True)
    sources=[load(p) for p in source_paths];cutouts=[load(p) for p in cutout_paths]
    if not sources and not cutouts:raise ValueError('No image inputs; use the title as composition core instead')
    if len(cutouts)>8:raise ValueError('Editor supports at most eight independent subject layers; request an explicit grouping for more')
    for im in cutouts:
        if im.getextrema()[3][0]==255:raise ValueError('Cutout input lacks transparency; extract it first')
    entries=[]
    if cutouts:
        tile=Image.new('RGBA',(w,h),'#efefef');cols=3;cell=(w-(cols+1)*gap)/cols;rows=math.ceil(h/(cell+gap))
        for row in range(rows):
            for col in range(cols):
                # Stable row-major cycle and equal cell spacing for multiple assets.
                im=fit(cutouts[(row*cols+col)%len(cutouts)],cell,cell)
                place(tile,im,gap+col*(cell+gap)+(cell-im.width)/2,gap+row*(cell+gap)+(cell-im.height)/2)
        path=out/'tile-preview.png';tile.convert('RGB').save(path)
        entries.append({'mode':'tile','file':path.name,'subjectType':'无主体（不能抠图）','subjectCount':len(cutouts),'pattern':{'columns':cols,'gapPixels':gap,'order':'row-major cyclic','cellSize':round(cell,2)}})
        subject=Image.new('RGBA',(w,h),'#efefef');count=len(cutouts);cols=1 if count==1 else 2;rows=math.ceil(count/cols)
        cw=(w-(cols+1)*gap)/cols;ch=(h-(rows+1)*gap)/rows
        for i,im in enumerate(cutouts):
            im=fit(im,cw,ch);place(subject,im,gap+(i%cols)*(cw+gap)+(cw-im.width)/2,gap+(i//cols)*(ch+gap)+(ch-im.height)/2)
        path=out/'subject-preview.png';subject.convert('RGB').save(path)
        entries.append({'mode':'subject','file':path.name,'subjectType':'单主体' if count==1 else '多主体','subjectCount':count})
    for kind,images in [('source',sources),('cutout',cutouts)]:
        if not images:continue
        collage=Image.new('RGBA',(w,h),'#efefef');cols=math.ceil(math.sqrt(len(images)));rows=math.ceil(len(images)/cols)
        cw=math.ceil(w/cols);ch=math.ceil(h/rows)
        for i,im in enumerate(images):
            im=ImageOps.fit(im,(cw,ch),Image.Resampling.LANCZOS);place(collage,im,(i%cols)*cw,(i//cols)*ch)
        blurred=collage.convert('RGB').filter(ImageFilter.GaussianBlur(max_edge*.035));path=out/f'blur-{kind}-preview.png';blurred.save(path)
        entries.append({'mode':'blur','variant':kind,'file':path.name,'subjectType':'无主体（不能抠图）','subjectCount':len(cutouts),'blurRadiusPixels':max_edge*.035})
    manifest={'previewOnly':True,'canvasRatio':ratio,'size':[w,h],'neutralPreviewBase':'#efefef','finalPaletteConfirmed':False,'sourceOrder':[str(p) for p in source_paths],'cutoutOrder':[str(p) for p in cutout_paths],'options':entries}
    (out/'material-options.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,action='append',default=[]);p.add_argument('--cutout',type=Path,action='append',default=[]);p.add_argument('--output-dir',required=True,type=Path);p.add_argument('--ratio',choices=['3:4','2:3','4:5'],default='3:4');p.add_argument('--gap',type=int,default=16);p.add_argument('--max-edge',type=int,default=480);args=p.parse_args()
    if not 128<=args.max_edge<=640 or not 1<=args.gap<args.max_edge//10:p.error('Preview edge must be 128–640; gap must be positive and below edge/10')
    print(json.dumps(create(args.source,args.cutout,args.output_dir,args.ratio,args.gap,args.max_edge),ensure_ascii=False))
