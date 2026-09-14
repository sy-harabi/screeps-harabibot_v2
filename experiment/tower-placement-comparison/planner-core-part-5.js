// ---- outer rampart roads (current v2) ----
function planOuterRampartRoads(terrain,controller,sources,minerals,outer,ca,core,resourceTree){
  const roadNet=new Uint8Array(ROOM_AREA); for(const c of [...core.roads,...resourceTree.roads]) roadNet[idx(c.x,c.y)]=1;
  const blocked=new Uint8Array(ROOM_AREA), block=c=>blocked[idx(c.x,c.y)]=1;
  [controller.pos,ca.storage,core.manager,core.terminal,core.firstSpawn,core.link,core.factory,core.powerSpawn,...core.parking].forEach(block);
  [...sources,...minerals].forEach(r=>block(r.pos)); for(const b of resourceTree.branches){block(b.container); if(b.link)block(b.link)}
  const chainCost=new Int16Array(ROOM_AREA); chainCost.fill(-1); for(const ch of Object.values(ca.upgradeChains)) ch.forEach((c,i)=>chainCost[idx(c.x,c.y)]=50-i*5);
  const components=findMaskComponents(outer.rampartMask), remaining=components.map((_,i)=>i), roads=[];
  while(remaining.length){
    const d=dijkstraMap(terrain,core.roads,(x,y,t)=>{const i=idx(x,y);if(chainCost[i]>=0)return chainCost[i];if(roadNet[i])return 3;return t===2?6:5},(x,y)=>{const i=idx(x,y);return !!((outer.insideMask[i]||outer.rampartMask[i])&&!blocked[i])});
    let target=null;
    for(const ci of remaining)for(const ti of components[ci]){const dist=d[ti];if(dist<0)continue;if(!target||dist<target.distance||(dist===target.distance&&(ci<target.componentIndex||(ci===target.componentIndex&&ti<target.tileIndex))))target={componentIndex:ci,tileIndex:ti,distance:dist}}
    if(!target)return;
    let cur=target.tileIndex; const path=[];
    while(!roadNet[cur]){const c=coord(cur),cd=d[cur];if(cd<=0)return;path.push(c);const cc=chainCost[cur]>=0?chainCost[cur]:roadNet[cur]?3:terrain.get(c.x,c.y)===2?6:5;let br=-1,b=-1;
      for(const o of NEIGHBOR_OFFSETS){const x=c.x+o.x,y=c.y+o.y;if(!inside(x,y))continue;const ni=idx(x,y),nd=d[ni];if(nd<0||nd+cc!==cd)continue;if(roadNet[ni]){if(br<0||ni<br)br=ni}else if(b<0||ni<b)b=ni}
      cur=br>=0?br:b;if(cur<0)return;
    }
    for(const c of path){const i=idx(c.x,c.y);if(!roadNet[i]){roadNet[i]=1;roads.push(c)}}
    remaining.splice(remaining.indexOf(target.componentIndex),1);
  }
  return {roads};
}
function findMaskComponents(mask){const vis=new Uint8Array(ROOM_AREA),out=[];for(let s=0;s<ROOM_AREA;s++){if(!mask[s]||vis[s])continue;const a=[s];vis[s]=1;for(let h=0;h<a.length;h++){const c=coord(a[h]);for(const o of NEIGHBOR_OFFSETS){const x=c.x+o.x,y=c.y+o.y;if(!inside(x,y))continue;const i=idx(x,y);if(mask[i]&&!vis[i]){vis[i]=1;a.push(i)}}}out.push(a)}return out}

// ---- labs (current v2) ----
