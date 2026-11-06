import struct,glob,re,json
OUT='adcode/out/'
RAW="/Users/james/Documents/Codex/2026-11-05/referenced-chatgpt-conversation-this-is-an/outputs/rat-race/raw/"
def symt(b):
    d={}
    for i in range(0,len(b)-13,14):
        sid=struct.unpack('>I',b[i:i+4])[0]; seg,off=struct.unpack('>HH',b[i+10:i+14]); d[sid]=(seg,off)
    return d
def jump(b): return [struct.unpack('>H',b[i:i+2])[0] for i in range(0,len(b),8)]
SYM={}
units=[]
for f in sorted(glob.glob(OUT+'*SYMT*')):
    rid=f.split('_SYMT_')[1].split('_')[0]; name=f.split('_SYMT_')[1][4:-4]
    J=jump(open(glob.glob(OUT+f'*JUMP_{rid}_*')[0],'rb').read())
    units.append((name,symt(open(f,'rb').read()),J))
for seg in ('129','130'):
    units.append((f'RR{seg}',symt(open(RAW+f'53594d54_{seg}.bin','rb').read()),jump(open(RAW+f'4a554d50_{seg}.bin','rb').read())))
for name,S,J in units:
    for k,(sg,off) in S.items():
        if sg==1:
            i=(off-2)//8
            SYM[k]=f'{name}.f{J[i]-4:04x}' if i<len(J) else f'{name}.jmp?{off}'
        else:
            SYM[k]=f'{name}.g{off:04x}'
json.dump({f'{k:04x}':v for k,v in SYM.items()},open('symbols.json','w'),indent=0)
# annotate module + libs
def annotate(src,dst,crlt):
    b=open(crlt,'rb').read(); ann={}
    for i in range(0,len(b)-11,12):
        t,off,kind,sym=struct.unpack('>HIhI',b[i:i+12])
        ann.setdefault(off-4,[]).append(SYM.get(sym,f'?{sym:04x}'))
    out=[]
    for ln in open(src).read().split('\n'):
        ln=re.sub(r'\s+;.*$','',ln)
        m=re.match(r'([0-9A-F]{8})\s+((?:[0-9A-F]{4} ?)+)',ln)
        if m:
            a=int(m.group(1),16); n=len(m.group(2).replace(' ',''))//2
            notes=sum([ann[x] for x in range(a,a+n) if x in ann],[])
            if notes: ln+='   ; '+', '.join(notes)
        out.append(ln)
    open(dst,'w').write('\n'.join(out))
CODE="/Users/james/Documents/Codex/2026-11-05/referenced-chatgpt-conversation-this-is-an/outputs/rat-race/code/"
annotate(CODE+'original.rsrc_CODE_129_RR_D1.txt','RR129.txt',RAW+'43524c54_129.bin')
annotate(CODE+'original.rsrc_CODE_130_RR_D2.txt','RR130.txt',RAW+'43524c54_130.bin')
for name,_,_ in units[:-2]:
    rid=[f for f in glob.glob(OUT+'*CRLT_*') if name in f][0]
    annotate(f'lib_{name}.txt',f'L_{name}.txt',rid)
print(len(SYM))
