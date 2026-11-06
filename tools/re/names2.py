import re,glob,json
names={}
for f in glob.glob('L_*.txt'):
    lib=f[2:-4]; cur=[]
    for ln in open(f):
        m=re.match(r'([0-9A-F]{8})\s+4E56 ',ln)
        if m: cur.append(int(m.group(1),16)); continue
        m=re.search(r'dc\.b\s+"([^"]+)"',ln)
        if m and cur:
            for a in cur: names[f'{lib}.f{a:04x}']=m.group(1)
            cur=[]
json.dump(names,open('libnames.json','w'),indent=0)
print(len(names))
for src in ('RR129.txt','RR130.txt'):
    t=open(src).read()
    t=re.sub(r'(AD3_\w+|Runtime)\.f([0-9a-f]{4})', lambda m: m.group(0)+'<'+names.get(m.group(0),'?')+'>', t)
    open(src.replace('.txt','n.txt'),'w').write(t)
