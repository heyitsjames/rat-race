import struct, re, subprocess, glob, sys, os
OUT='adcode/out/'
DASM="/Users/james/Documents/Codex/2026-11-05/referenced-chatgpt-conversation-this-is-an/work/resource_dasm/build/m68kdasm"
def symt(path):
    b=open(path,'rb').read(); d={}
    for i in range(0,len(b)-13,14):
        sid=struct.unpack('>I',b[i:i+4])[0]; seg,off=struct.unpack('>HH',b[i+10:i+14]); d[sid]=(seg,off)
    return d
def relocs(path):
    b=open(path,'rb').read()
    return [struct.unpack('>HIhI',b[i:i+12]) for i in range(0,len(b)-11,12)]
ALL={}
libs={}
for f in sorted(glob.glob(OUT+'*SYMT*')):
    rid=f.split('_SYMT_')[1].split('_')[0]; name=f.split('_SYMT_')[1][4:-4]
    for k,v in symt(f).items(): ALL[k]=(name,)+v
    libs[rid]=name
for rid,name in libs.items():
    code=open(glob.glob(OUT+f'*CODE_{rid}_*')[0],'rb').read()[4:]
    open(f'lib_{name}.bin','wb').write(code)
    txt=subprocess.run([DASM,'--68k',f'lib_{name}.bin'],capture_output=True,text=True).stdout
    ann={}
    for t,off,kind,sym in relocs(glob.glob(OUT+f'*CRLT_{rid}_*')[0]):
        loc=ALL.get(sym)
        ann[off-4]=f"; {'code' if kind==-2 else 'data'} sym{sym:04x}"+(f"={loc[0]}:{loc[1]}:{loc[2]:#x}" if loc else "")
    # mark symbol definitions (seg 0 = code?) 
    defs={}
    for k,(n,seg,off) in ALL.items():
        if n==name: defs.setdefault((seg,off),[]).append(f'sym{k:04x}')
    out=[]
    for ln in txt.split('\n'):
        m=re.match(r'([0-9A-F]{8})\s+((?:[0-9A-F]{4} ?)+)',ln)
        if m:
            a=int(m.group(1),16); n=len(m.group(2).replace(' ',''))//2
            if (0,a) in defs: out.append(f'==== DEF {" ".join(defs[(0,a)])} (seg0:{a:#x})')
            notes=[ann[x] for x in range(a,a+n) if x in ann]
            if notes: ln+='   '+' '.join(notes)
        out.append(ln)
    open(f'lib_{name}.txt','w').write('\n'.join(out))
for s in ['00ac','00ad','00ae','00af','0510','0364','050f','04fa','013d','050a','0367','0639','0369','066f','0651','063a','04fb','036e','013b','0003','0001','0000','0692','050e','04b0','0496','0344']:
    print(s, ALL.get(int(s,16)))
