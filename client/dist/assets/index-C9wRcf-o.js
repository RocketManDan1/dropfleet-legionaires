var Me=Object.defineProperty;var ye=(i,t,e)=>t in i?Me(i,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):i[t]=e;var m=(i,t,e)=>ye(i,typeof t!="symbol"?t+"":t,e);import{V as q,P as xe,M as Zt,G as lt,a as $t,F as nt,S as bt,b as zt,c as L,C as Lt,D as Ht,d as ct,e as U,R as Se,f as Ut,g as Nt,I as It,h as Ce,O as be,i as ht,B as Q,E as ae,L as re,j as At,k as ce,l as Ie,m as jt,n as qt,o as Wt,p as Ot,q as le,r as Te,s as De,W as Pe,t as ke}from"./three-zN8rk0G7.js";(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const o of s)if(o.type==="childList")for(const a of o.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function e(s){const o={};return s.integrity&&(o.integrity=s.integrity),s.referrerPolicy&&(o.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?o.credentials="include":s.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function n(s){if(s.ep)return;s.ep=!0;const o=e(s);fetch(s.href,o)}})();class Ee{constructor(t){m(this,"camera");m(this,"target",new q(100,0,100));m(this,"distance",120);m(this,"azimuth",Math.PI*.25);m(this,"elevation",Math.PI*.3);m(this,"minDistance",20);m(this,"maxDistance",300);m(this,"minElevation",.1);m(this,"maxElevation",Math.PI*.45);m(this,"keys",new Set);m(this,"isDragging",!1);m(this,"dragButton",-1);m(this,"lastMouse",{x:0,y:0});m(this,"mousePos",{x:0,y:0});m(this,"panSpeed",.15);m(this,"keyPanSpeed",1.5);m(this,"orbitSpeed",.005);m(this,"zoomSpeed",8);m(this,"edgeScrollZone",40);m(this,"hmData",null);m(this,"hmWidth",0);m(this,"hmHeight",0);m(this,"hmScale",40);m(this,"hmSeaLevel",0);m(this,"hmDiscRadius",0);m(this,"hmCurvatureRadius",4e3);m(this,"cameraMargin",5);this.camera=new xe(50,t,.5,2e3),this.updateCameraPosition(),this.bindEvents()}setTerrainData(t,e){this.hmData=t.heightmap,this.hmWidth=t.width,this.hmHeight=t.height,this.hmScale=e,this.hmSeaLevel=t.seaLevel*e,this.hmDiscRadius=Math.min(t.width,t.height)/2,this.target.set(t.width/2,0,t.height/2)}getTerrainHeight(t,e){if(!this.hmData)return 0;const n=Math.max(0,Math.min(this.hmWidth-2,t)),s=Math.max(0,Math.min(this.hmHeight-2,e)),o=Math.floor(n),a=Math.floor(s),r=n-o,c=s-a,d=this.hmData[a*this.hmWidth+o],u=this.hmData[a*this.hmWidth+o+1],l=this.hmData[(a+1)*this.hmWidth+o],h=this.hmData[(a+1)*this.hmWidth+o+1];let g=(d*(1-r)*(1-c)+u*r*(1-c)+l*(1-r)*c+h*r*c)*this.hmScale;const p=this.hmWidth/2,v=this.hmHeight/2,y=t-p,x=e-v,C=Math.sqrt(y*y+x*x),H=Math.max(0,Math.min(1,(C-this.hmDiscRadius)/(this.hmDiscRadius*.88-this.hmDiscRadius))),b=H*H*(3-2*H);g=this.hmSeaLevel+(g-this.hmSeaLevel)*b;const w=C*C/(2*this.hmCurvatureRadius);return g-=w,g}getSeaLevelAt(t,e){const n=this.hmWidth/2,s=this.hmHeight/2,o=t-n,a=e-s,r=Math.sqrt(o*o+a*a),c=r*r/(2*this.hmCurvatureRadius);return this.hmSeaLevel-c}bindEvents(){window.addEventListener("keydown",t=>this.keys.add(t.code)),window.addEventListener("keyup",t=>this.keys.delete(t.code)),window.addEventListener("mousedown",t=>{(t.button===1||t.button===2)&&(this.isDragging=!0,this.dragButton=t.button,this.lastMouse={x:t.clientX,y:t.clientY})}),window.addEventListener("mouseup",()=>{this.isDragging=!1,this.dragButton=-1}),window.addEventListener("mousemove",t=>{if(this.mousePos={x:t.clientX,y:t.clientY},!this.isDragging)return;const e=t.clientX-this.lastMouse.x,n=t.clientY-this.lastMouse.y;if(this.lastMouse={x:t.clientX,y:t.clientY},this.dragButton===1)this.azimuth-=e*this.orbitSpeed,this.elevation+=n*this.orbitSpeed,this.elevation=Zt.clamp(this.elevation,this.minElevation,this.maxElevation);else if(this.dragButton===2){const s=new q(-Math.sin(this.azimuth),0,-Math.cos(this.azimuth)),o=new q(Math.cos(this.azimuth),0,-Math.sin(this.azimuth));this.target.addScaledVector(o,-e*this.panSpeed),this.target.addScaledVector(s,n*this.panSpeed)}}),window.addEventListener("wheel",t=>{t.preventDefault(),this.distance+=Math.sign(t.deltaY)*this.zoomSpeed,this.distance=Zt.clamp(this.distance,this.minDistance,this.maxDistance)},{passive:!1}),window.addEventListener("contextmenu",t=>t.preventDefault())}update(t){const e=new q(-Math.sin(this.azimuth),0,-Math.cos(this.azimuth)),n=new q(Math.cos(this.azimuth),0,-Math.sin(this.azimuth));(this.keys.has("KeyW")||this.keys.has("ArrowUp"))&&this.target.addScaledVector(e,this.keyPanSpeed),(this.keys.has("KeyS")||this.keys.has("ArrowDown"))&&this.target.addScaledVector(e,-this.keyPanSpeed),(this.keys.has("KeyA")||this.keys.has("ArrowLeft"))&&this.target.addScaledVector(n,-this.keyPanSpeed),(this.keys.has("KeyD")||this.keys.has("ArrowRight"))&&this.target.addScaledVector(n,this.keyPanSpeed);const s=window.innerWidth,o=window.innerHeight,a=this.edgeScrollZone,r=this.keyPanSpeed*.8;if(this.mousePos.x<a&&this.target.addScaledVector(n,-r),this.mousePos.x>s-a&&this.target.addScaledVector(n,r),this.mousePos.y<a&&this.target.addScaledVector(e,r),this.mousePos.y>o-a&&this.target.addScaledVector(e,-r),this.hmData){const c=this.getTerrainHeight(this.target.x,this.target.z),d=this.getSeaLevelAt(this.target.x,this.target.z);this.target.y=Math.max(c,d)}this.updateCameraPosition()}updateCameraPosition(){const t=this.target.x+this.distance*Math.cos(this.elevation)*Math.sin(this.azimuth),e=this.target.y+this.distance*Math.sin(this.elevation),n=this.target.z+this.distance*Math.cos(this.elevation)*Math.cos(this.azimuth);if(this.hmData){const s=this.getTerrainHeight(t,n),o=this.getSeaLevelAt(t,n),r=Math.max(s,o)+this.cameraMargin;this.camera.position.set(t,Math.max(e,r),n)}else this.camera.position.set(t,e,n);this.camera.lookAt(this.target)}resize(t){this.camera.aspect=t,this.camera.updateProjectionMatrix()}}class Ae{constructor(){m(this,"ws",null);m(this,"handlers",new Map);m(this,"statusEl");this.statusEl=document.getElementById("status")}connect(){const e=`${location.protocol==="https:"?"wss:":"ws:"}//${location.hostname}:3000`;this.statusEl.textContent="CONNECTING...",this.statusEl.className="",this.ws=new WebSocket(e),this.ws.onopen=()=>{this.statusEl.textContent="CONNECTED",this.statusEl.className=""},this.ws.onmessage=n=>{try{const s=JSON.parse(n.data),o=this.handlers.get(s.type)||[];for(const a of o)a(s)}catch(s){console.error("Failed to parse message:",s)}},this.ws.onclose=()=>{this.statusEl.textContent="DISCONNECTED",this.statusEl.className="disconnected",setTimeout(()=>this.connect(),2e3)},this.ws.onerror=()=>{var n;(n=this.ws)==null||n.close()}}on(t,e){this.handlers.has(t)||this.handlers.set(t,[]),this.handlers.get(t).push(e)}send(t,e){var n;((n=this.ws)==null?void 0:n.readyState)===WebSocket.OPEN&&this.ws.send(JSON.stringify({type:t,...e}))}}const Re=52,Fe=`
  uniform vec3 terrainCenter;
  uniform float curvatureRadius;
  uniform float discRadius;
  uniform float seaLevel;

  attribute float aSlope;
  attribute float aCurvature;
  attribute float aWetness;
  attribute float aCover;
  attribute float aVisibility;
  attribute float aForest;
  attribute float aMountainWeight;
  attribute float aHillWeight;
  attribute float aFlatlandWeight;

  varying float vHeight;
  varying vec3 vWorldPos;
  varying float vDistFromCenter;
  varying float vSlope;
  varying float vCurvature;
  varying float vWetness;
  varying float vCover;
  varying float vVisibility;
  varying float vForest;
  varying vec3 vBiomeWeights;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    float dx = worldPos.x - terrainCenter.x;
    float dz = worldPos.z - terrainCenter.z;
    float dist = sqrt(dx * dx + dz * dz);
    vDistFromCenter = dist;

    // Taper terrain to sea level at disc edge
    float edgeFade = smoothstep(discRadius, discRadius * 0.88, dist);
    float tapered = mix(seaLevel, worldPos.y, edgeFade);
    worldPos.y = tapered;

    // Spherical curvature
    float drop = (dist * dist) / (2.0 * curvatureRadius);
    worldPos.y -= drop;

    vHeight = tapered;
    vWorldPos = worldPos.xyz;
    vSlope = aSlope;
    vCurvature = aCurvature;
    vWetness = aWetness;
    vCover = aCover;
    vVisibility = aVisibility;
    vForest = aForest;
    vBiomeWeights = vec3(aMountainWeight, aHillWeight, aFlatlandWeight);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`,_e=`
  uniform float seaLevel;
  uniform float maxHeight;
  uniform float discRadius;
  uniform float fadeStart;
  uniform float fadeEnd;

  varying float vHeight;
  varying vec3 vWorldPos;
  varying float vDistFromCenter;
  varying float vSlope;
  varying float vCurvature;
  varying float vWetness;
  varying float vCover;
  varying float vVisibility;
  varying float vForest;
  varying vec3 vBiomeWeights;

  void main() {
    if (vDistFromCenter > discRadius) discard;

    // Rebuild the normal from the final deformed world-space surface so
    // lighting remains consistent across camera angles.
    vec3 dpdx = dFdx(vWorldPos);
    vec3 dpdy = dFdy(vWorldPos);
    vec3 surfaceNormal = normalize(cross(dpdx, dpdy));
    if (!gl_FrontFacing) surfaceNormal *= -1.0;

    float h = clamp(vHeight / maxHeight, 0.0, 1.0);
    float seaH = seaLevel / maxHeight;

    // Strong key light — steep angle for dramatic shadows
    vec3 lightDir = normalize(vec3(0.3, 0.8, 0.25));
    float diffuse = max(dot(surfaceNormal, lightDir), 0.0);
    // Boost contrast: steepen the light falloff
    diffuse = pow(diffuse, 0.7);

    // Subtle fill from opposite side
    vec3 fillDir = normalize(vec3(-0.4, 0.3, -0.3));
    float fill = max(dot(surfaceNormal, fillDir), 0.0) * 0.15;

    float ambient = 0.32;
    float lighting = ambient + diffuse * 0.72 + fill;

    vec3 color;

    if (h < seaH) {
      // Seafloor: render as dark terrain visible through the water plane above
      float depth = clamp(h / max(seaH, 0.0001), 0.0, 1.0); // 0 = deepest, 1 = shore
      vec3 deepFloor    = vec3(0.06, 0.08, 0.12);
      vec3 shallowFloor = vec3(0.13, 0.15, 0.20);
      color = mix(deepFloor, shallowFloor, depth);
      color = mix(color, vec3(0.12, 0.17, 0.24), vWetness * 0.30);
      color *= (0.55 + 0.45 * lighting);
    } else {
      // Land: neutral gray satellite look — darker base, bright highlights
      float landH = (h - seaH) / (1.0 - seaH);

      // Neutral gray ramp (no warm tint)
      vec3 lowland  = vec3(0.22, 0.22, 0.22);
      vec3 midland  = vec3(0.38, 0.37, 0.36);
      vec3 highland = vec3(0.52, 0.51, 0.50);
      vec3 peak     = vec3(0.68, 0.67, 0.65);

      if (landH < 0.3) {
        color = mix(lowland, midland, landH / 0.3);
      } else if (landH < 0.6) {
        color = mix(midland, highland, (landH - 0.3) / 0.3);
      } else {
        color = mix(highland, peak, (landH - 0.6) / 0.4);
      }

      // Biome-aware tone response: mountain areas get brighter high-contrast ridges,
      // flatland areas stay smoother/darker, hills sit in between.
      float mountainBias = vBiomeWeights.x;
      float flatBias = vBiomeWeights.z;
      color = mix(color, color * 1.15 + vec3(0.03), mountainBias * 0.35);
      color = mix(color, color * 0.85, flatBias * 0.25);

      color *= lighting;

      // Slope darkening — makes ravines and cliff faces darker
      float slope = 1.0 - abs(dot(surfaceNormal, vec3(0.0, 1.0, 0.0)));
      color *= mix(1.0, 0.55, slope);

      // Derived-map shaping for tactical readability.
      color *= mix(1.0, 0.72, vSlope * 0.45);
      color *= mix(1.0, 1.15, (1.0 - vCurvature) * 0.35);
      color = mix(color, color * 0.9 + vec3(0.02, 0.03, 0.03), vWetness * 0.2);

      // Thin neutral shoreline highlight.
      float shoreBand = 1.0 - smoothstep(0.0, 0.012, abs(h - seaH));
      color += vec3(0.70, 0.73, 0.74) * shoreBand * 0.22;

      // Tactical readability overlays:
      // 1) subtle contour lines for shape readability
      float contourFreq = 36.0;
      float contourPhase = fract(h * contourFreq);
      float contourDist = abs(contourPhase - 0.5);
      float contourWidth = fwidth(h * contourFreq) * 0.9;
      float contourLine = 1.0 - smoothstep(0.0, contourWidth, contourDist);
      color = mix(color, color * 0.82, contourLine * 0.14);

      // 2) high-visibility ridges: gentle bright lift
      float visBoost = smoothstep(0.62, 0.92, vVisibility);
      color += vec3(0.16) * visBoost * 0.18;

      // 3) high-cover zones: fine hatch darkening for instant recognition
      float hatch1 = step(0.84, fract((vWorldPos.x + vWorldPos.z) * 0.11));
      float hatch2 = step(0.88, fract((vWorldPos.x - vWorldPos.z) * 0.09));
      float hatch = max(hatch1, hatch2);
      float coverMask = smoothstep(0.58, 0.9, vCover);
      color *= (1.0 - hatch * coverMask * 0.16);

      // (Forest regions are rendered via instanced tree meshes, no ground tint needed)
    }

    // Edge fade
    float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistFromCenter);
    color *= fadeFactor;

    gl_FragColor = vec4(color, 1.0);
  }
`,ze=`
  uniform vec3 terrainCenter;
  uniform float curvatureRadius;
  uniform float discRadius;
  uniform float gridHoverHeight;

  varying vec3 vWorldPos;
  varying float vDistFromCenter;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    float dx = worldPos.x - terrainCenter.x;
    float dz = worldPos.z - terrainCenter.z;
    float dist = sqrt(dx * dx + dz * dz);
    vDistFromCenter = dist;

    // Keep grid at a fixed altitude above the terrain model.
    worldPos.y = gridHoverHeight;

    float drop = (dist * dist) / (2.0 * curvatureRadius);
    worldPos.y -= drop;

    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`,Le=`
  uniform float gridSpacing;
  uniform float discRadius;
  uniform float fadeStart;
  uniform float fadeEnd;

  varying vec3 vWorldPos;
  varying float vDistFromCenter;

  void main() {
    if (vDistFromCenter > discRadius) discard;

    // Minor grid
    vec2 coord = vWorldPos.xz / gridSpacing;
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    float line = min(grid.x, grid.y);
    float minorAlpha = (1.0 - min(line, 1.0)) * 0.15;

    // Major grid every 10 cells
    vec2 majorCoord = vWorldPos.xz / (gridSpacing * 10.0);
    vec2 majorGrid = abs(fract(majorCoord - 0.5) - 0.5) / fwidth(majorCoord);
    float majorLine = min(majorGrid.x, majorGrid.y);
    float majorAlpha = (1.0 - min(majorLine, 1.0)) * 0.45;

    float finalAlpha = max(minorAlpha, majorAlpha);

    // Edge fade
    float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistFromCenter);
    finalAlpha *= fadeFactor;

    if (finalAlpha < 0.01) discard;

    // White grid lines
    gl_FragColor = vec4(vec3(0.85, 0.85, 0.82), finalAlpha);
  }
`,He=`
  uniform vec3 glowColor;
  uniform float innerRadius;
  uniform float outerRadius;

  varying vec2 vUv;

  void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered) * 2.0;

    // Tight ring glow
    float ring = smoothstep(innerRadius, innerRadius + 0.08, dist)
               * (1.0 - smoothstep(innerRadius + 0.08, outerRadius, dist));
    // Subtle outer haze
    float haze = smoothstep(innerRadius - 0.1, innerRadius + 0.04, dist)
               * (1.0 - smoothstep(outerRadius, outerRadius + 0.15, dist)) * 0.3;

    float glow = max(ring, haze);

    if (glow < 0.01) discard;

    gl_FragColor = vec4(glowColor * glow, glow);
  }
`,Ne=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;function ot(i,t,e){const n=new Float32Array(t);if(!i||i.length!==t)return n.fill(e),n;for(let s=0;s<t;s++){const o=i[s];n[s]=Number.isFinite(o)?o:e}return n}function de(i){let t=i>>>0||1;return()=>{t+=1831565813;let e=Math.imul(t^t>>>15,1|t);return e^=e+Math.imul(e^e>>>7,61|e),((e^e>>>14)>>>0)/4294967296}}function tt(i,t,e,n,s,o){if(!i||i.length!==t*e)return o;const a=Math.max(0,Math.min(t-1.001,n)),r=Math.max(0,Math.min(e-1.001,s)),c=Math.floor(a),d=Math.floor(r),u=Math.min(t-1,c+1),l=Math.min(e-1,d+1),h=a-c,f=r-d,g=i[d*t+c],p=i[d*t+u],v=i[l*t+c],y=i[l*t+u];return g*(1-h)*(1-f)+p*h*(1-f)+v*(1-h)*f+y*h*f}function j(i,t,e){const n=Math.max(0,Math.min(1,(e-i)/(t-i)));return n*n*(3-2*n)}function We(i){var x,C,H,b;const{width:t,height:e,heightmap:n,seaLevel:s}=i,o=t*e,a=new Float32Array(o),r=20,c=t*r*(e*r)/1e6,d=Math.max(12,Math.min(40,Math.floor(c*.3))),u=[],l=de(t*2654435761^e*2246822519^1540483477),h=t*.5,f=e*.5,g=Math.min(t,e)*.5;for(let w=0;w<d*80&&u.length<d;w++){const P=l()*Math.PI*2,R=Math.sqrt(l())*(g*.85),G=h+Math.cos(P)*R,D=f+Math.sin(P)*R;tt(n,t,e,G,D,s)<=s+.02||tt(i.slopeMap,t,e,G,D,.4)>.82||u.push({x:G,z:D,radius:35+l()*55,density:.9+l()*.8})}u.length===0&&u.push({x:h,z:f,radius:g*.35,density:1}),console.log(`[Forest] ${u.length} patches, radii: ${u.map(w=>w.radius.toFixed(0)).join(", ")}`);for(let w=0;w<e;w++)for(let P=0;P<t;P++){const R=w*t+P;if(n[R]<=s+.01){a[R]=0;continue}const D=((x=i.slopeMap)==null?void 0:x[R])??.4,S=((C=i.wetnessMap)==null?void 0:C[R])??.3,X=((H=i.coverMap)==null?void 0:H[R])??.35,$=((b=i.visibilityMap)==null?void 0:b[R])??.5,F=1-j(.45,.9,D),W=j(.08,.82,S),O=j(.2,.9,X)*(1-j(.75,.98,$)),at=F*.35+W*.3+O*.35;let I=0;for(let T=0;T<u.length;T++){const z=P-u[T].x,k=w-u[T].z,E=Math.sqrt(z*z+k*k);if(E>u[T].radius)continue;const N=1-j(u[T].radius*.55,u[T].radius,E);I=Math.max(I,N*u[T].density)}a[R]=Math.max(0,Math.min(1,at*.35+I*.9))}let p=0,v=0,y=0;for(let w=0;w<o;w++)a[w]>0&&p++,a[w]>.18&&v++,a[w]>y&&(y=a[w]);return console.log(`[Forest] map stats: total=${o}, nonZero=${p} (${(p/o*100).toFixed(1)}%), above threshold=${v} (${(v/o*100).toFixed(1)}%), max=${y.toFixed(3)}`),a}function Oe(i,t,e,n,s,o,a){const r=new lt,{width:c,height:d,heightmap:u}=i,l=20,h=2.2,f=(I,T)=>{const k=tt(u,c,d,I,T,i.seaLevel)*t,E=I-n,N=T-s,A=Math.sqrt(E*E+N*N),Y=j(o,o*.88,A),K=e+(k-e)*Y,_=A*A/(2*a);return K-_},g=c*l*(d*l)/1e6,p=Math.min(9e3,Math.max(1200,Math.floor(g*95))),v=new ct(.04,.06,1,6),y=new Nt(.5,.7,6),x=new Nt(.38,.6,6),C=new Nt(.26,.5,6),H=new U({color:3815994}),b=new U({color:7368816}),w=new It(v,H,p),P=new It(y,b,p),R=new It(x,b,p),G=new It(C,b,p);for(const I of[w,P,R,G])I.instanceMatrix.setUsage(Ce),I.frustumCulled=!1,I.castShadow=!1;const D=de(c*73856093^d*19349663^Math.floor(i.seaLevel*1e6)),S=new be,X=new Set,$=.9,F=Math.max(10,Math.min(32,Math.floor(g*.26))),W=[];for(let I=0;I<F*60&&W.length<F;I++){const T=D()*Math.PI*2,z=Math.sqrt(D())*(o*.9),k=n+Math.cos(T)*z,E=s+Math.sin(T)*z;if(tt(u,c,d,k,E,i.seaLevel)<=i.seaLevel+.015||tt(i.slopeMap,c,d,k,E,.4)>.72)continue;const Y=10+D()*20;let K=!1;for(let _=0;_<W.length;_++){const B=k-W[_].x,dt=E-W[_].z;if(Math.sqrt(B*B+dt*dt)<(Y+W[_].radius)*.55){K=!0;break}}K||W.push({x:k,z:E,radius:Y,density:.9+D()*.8})}W.length===0&&W.push({x:n,z:s,radius:o*.25,density:1});let O=0;const at=(I,T,z)=>{if(O>=p)return;const E=(10+D()*16)/l*h,N=E*.35,A=E*.42;S.position.set(I,z+N*.5,T),S.scale.set(1,N,1),S.rotation.set(0,D()*Math.PI*2,0),S.updateMatrix(),w.setMatrixAt(O,S.matrix);const Y=z+N,K=A*.7;S.position.set(I,Y+K*.5,T),S.scale.set(A,A,A),S.rotation.set(0,D()*Math.PI*2,0),S.updateMatrix(),P.setMatrixAt(O,S.matrix);const _=A*.6;S.position.set(I,Y+K*.55+_*.5,T),S.scale.set(A*.82,A*.85,A*.82),S.rotation.set(0,D()*Math.PI*2,0),S.updateMatrix(),R.setMatrixAt(O,S.matrix);const B=A*.5;S.position.set(I,Y+K*.55+_*.45+B*.5,T),S.scale.set(A*.62,A*.7,A*.62),S.rotation.set(0,D()*Math.PI*2,0),S.updateMatrix(),G.setMatrixAt(O,S.matrix),O++};for(let I=0;I<W.length&&O<p;I++){const T=W[I],z=1.2+1/T.density,k=T.radius;for(let E=-k;E<=k&&O<p;E+=z)for(let N=-k;N<=k&&O<p;N+=z){const A=Math.sqrt(E*E+N*N);if(A>k)continue;const Y=(D()-.5)*z*.8,K=(D()-.5)*z*.8,_=T.x+E+Y,B=T.z+N+K;if(Math.sqrt((_-n)**2+(B-s)**2)>o*.95||tt(u,c,d,_,B,i.seaLevel)<=i.seaLevel+.01)continue;const wt=tt(i.slopeMap,c,d,_,B,.4),Mt=tt(i.wetnessMap,c,d,_,B,.3),Ft=tt(i.coverMap,c,d,_,B,.35),yt=tt(i.visibilityMap,c,d,_,B,.5),xt=1-j(.42,.86,wt),St=j(.12,.8,Mt),_t=j(.2,.85,Ft)*(1-j(.68,.96,yt)),Ct=1-j(k*.55,k,A),ve=.3+(xt*.35+St*.3+_t*.35)*.45+Ct*T.density*.35;if(D()>Math.min(1,ve))continue;const Vt=`${Math.floor(_/$)}:${Math.floor(B/$)}`;if(X.has(Vt))continue;X.add(Vt);const we=f(_,B);at(_,B,we)}}w.count=O,P.count=O,R.count=O,G.count=O;for(const I of[w,P,R,G])I.instanceMatrix.needsUpdate=!0;return console.log(`Procedural forest: ${O} evergreen trees`),r.add(w,P,R,G),r}function Ge(i){const t=new lt,{width:e,height:n,heightmap:s,seaLevel:o}=i,a=Re,r=o*a,c=e/2,d=n/2,u=new q(c,0,d),l=Math.min(e,n)/2,h=4e3,f=l*.88,g=l*1,p=new $t(e,n,e-1,n-1);p.rotateX(-Math.PI/2);const v=p.attributes.position;for(let ft=0;ft<v.count;ft++)v.setY(ft,s[ft]*a);const y=ot(i.slopeMap,v.count,.5),x=ot(i.curvatureMap,v.count,.5),C=ot(i.wetnessMap,v.count,.25),H=ot(i.coverMap,v.count,.35),b=ot(i.visibilityMap,v.count,.5),w=We(i),P=ot(i.mountainWeightMap,v.count,.33),R=ot(i.hillWeightMap,v.count,.34),G=ot(i.flatlandWeightMap,v.count,.33);p.setAttribute("aSlope",new nt(y,1)),p.setAttribute("aCurvature",new nt(x,1)),p.setAttribute("aWetness",new nt(C,1)),p.setAttribute("aCover",new nt(H,1)),p.setAttribute("aVisibility",new nt(b,1)),p.setAttribute("aForest",new nt(w,1)),p.setAttribute("aMountainWeight",new nt(P,1)),p.setAttribute("aHillWeight",new nt(R,1)),p.setAttribute("aFlatlandWeight",new nt(G,1)),p.computeVertexNormals();const D={terrainCenter:{value:u},curvatureRadius:{value:h},discRadius:{value:l},fadeStart:{value:f},fadeEnd:{value:g},seaLevel:{value:r}},S=new bt({vertexShader:Fe,fragmentShader:_e,uniforms:{maxHeight:{value:a},...D},extensions:{derivatives:!0},side:zt}),X=new L(p,S);X.name="terrain-surface",X.position.set(c,0,d),t.add(X);const $=a+3,F=new Lt(l,256);F.rotateX(-Math.PI/2);const W=new bt({vertexShader:ze,fragmentShader:Le,uniforms:{gridSpacing:{value:5},gridHoverHeight:{value:$},...D},transparent:!0,depthWrite:!1,depthTest:!0}),O=new L(F,W);O.position.set(c,0,d),t.add(O);const at=128,I=new Lt(l,at);I.rotateX(-Math.PI/2);const T=`
    uniform vec3 terrainCenter;
    uniform float curvatureRadius;
    uniform float discRadius;

    varying float vDistFromCenter;
    varying vec3 vWorldPos;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);

      float dx = worldPos.x - terrainCenter.x;
      float dz = worldPos.z - terrainCenter.z;
      float dist = sqrt(dx * dx + dz * dz);
      vDistFromCenter = dist;

      // Same curvature as terrain
      float drop = (dist * dist) / (2.0 * curvatureRadius);
      worldPos.y -= drop;

      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,z=`
    uniform float discRadius;
    uniform float fadeStart;
    uniform float fadeEnd;

    varying float vDistFromCenter;
    varying vec3 vWorldPos;

    void main() {
      if (vDistFromCenter > discRadius) discard;

      // Minimal dark glass water (neutral, not saturated blue).
      vec3 deepWater = vec3(0.09, 0.10, 0.12);
      vec3 shoreWater = vec3(0.12, 0.13, 0.15);
      float depthBlend = smoothstep(0.0, discRadius * 0.62, vDistFromCenter);
      vec3 waterColor = mix(deepWater, shoreWater, depthBlend * 0.35);

      // Subtle glassy sheen using a simple fresnel term.
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 2.2);
      waterColor += vec3(0.20) * fresnel * 0.16;

      float alpha = 0.62;

      // Edge fade
      float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistFromCenter);
      alpha *= fadeFactor;

      gl_FragColor = vec4(waterColor, alpha);
    }
  `,k=new bt({vertexShader:T,fragmentShader:z,uniforms:{terrainCenter:{value:u},curvatureRadius:{value:h},discRadius:{value:l},fadeStart:{value:f},fadeEnd:{value:g}},transparent:!0,depthWrite:!1,side:Ht}),E=new L(I,k);E.position.set(c,r,d),t.add(E);const N=128,A=6,Y=r-A,K=new ct(l,l,A,N,1,!0),_=new U({color:526856,side:zt}),B=new L(K,_);B.position.set(c,r-A/2,d),t.add(B);const dt=new Lt(l,N);dt.rotateX(Math.PI/2);const Rt=new U({color:263428,side:zt}),wt=new L(dt,Rt);wt.position.set(c,Y,d),t.add(wt);const Mt=new Se(l-.5,l+.5,N);Mt.rotateX(-Math.PI/2);const Ft=new U({color:new Ut(.15,.5,.35),side:Ht,transparent:!0,opacity:.8}),yt=new L(Mt,Ft);yt.position.set(c,r+.1,d),t.add(yt);const xt=l*2.4,St=new $t(xt,xt);St.rotateX(-Math.PI/2);const _t=new bt({vertexShader:Ne,fragmentShader:He,uniforms:{glowColor:{value:new Ut(0,.9,.5)},innerRadius:{value:.8},outerRadius:{value:.95}},transparent:!0,depthWrite:!1,side:Ht}),Ct=new L(St,_t);return Ct.position.set(c,Y-.5,d),t.add(Ct),t.add(Oe(i,a,r,c,d,l,h)),t}const Dt=52,Be=4e3,J={steelworks:{id:"steelworks",siloChance:.5,stackChance:.92,towerChance:.68,pipeChance:.78,shedChance:.52,utilityScale:1.3,moduleScale:1.1,pipeColor:8871746,towerColor:4146505},refinery:{id:"refinery",siloChance:.88,stackChance:.58,towerChance:.44,pipeChance:.94,shedChance:.42,utilityScale:1.24,moduleScale:1.2,pipeColor:9266761,towerColor:4936020},brickworks:{id:"brickworks",siloChance:.42,stackChance:.86,towerChance:.36,pipeChance:.48,shedChance:.76,utilityScale:.92,moduleScale:.85,pipeColor:9071953,towerColor:4934214}},Xt=[{id:"residential-blocks",districtType:"residential",color:{wall:6974054,roof:9079428,edge:12109762,emissiveAccent:4968343},buildingCount:{min:12,max:22},footprintWidth:{min:2,max:6},footprintDepth:{min:2,max:6},floors:{min:1,max:2},floorHeight:{min:1.1,max:1.5},roofWeights:{flat:.72,shed:.25,sawtooth:.03},rooftopModuleDensity:{min:.08,max:.24},utilityDensity:{min:.06,max:.2},clusterRadius:{min:20,max:34}},{id:"industrial-compound",districtType:"industrial",color:{wall:5725277,roof:7370359,edge:12964558,emissiveAccent:14723130},buildingCount:{min:7,max:13},footprintWidth:{min:4,max:10},footprintDepth:{min:3,max:8},floors:{min:1,max:2},floorHeight:{min:1.4,max:2.1},roofWeights:{flat:.28,shed:.2,sawtooth:.52},rooftopModuleDensity:{min:.25,max:.5},utilityDensity:{min:.26,max:.55},clusterRadius:{min:24,max:40}}];function Z(i,t,e){return Math.max(t,Math.min(e,i))}function he(i,t,e){const n=Z((e-i)/(t-i),0,1);return n*n*(3-2*n)}function Ue(i){let t=i>>>0;return()=>{t+=1831565813;let e=Math.imul(t^t>>>15,1|t);return e^=e+Math.imul(e^e>>>7,61|e),((e^e>>>14)>>>0)/4294967296}}function Xe(i){let t=2166136261;const e=Math.max(1,Math.floor(i.heightmap.length/128));for(let n=0;n<i.heightmap.length;n+=e){const s=Math.floor(i.heightmap[n]*1e4);t^=s,t=Math.imul(t,16777619)}return t^=i.width,t=Math.imul(t,16777619),t^=i.height,t=Math.imul(t,16777619),t>>>0}function M(i,t,e){return t+(e-t)*i()}function vt(i,t,e){return Math.floor(M(i,t,e+1))}function Pt(i,t,e,n,s,o){if(!i||i.length!==t*e)return o;const a=Z(n,0,t-1.001),r=Z(s,0,e-1.001),c=Math.floor(a),d=Math.floor(r),u=Math.min(t-1,c+1),l=Math.min(e-1,d+1),h=a-c,f=r-d,g=i[d*t+c],p=i[d*t+u],v=i[l*t+c],y=i[l*t+u];return g*(1-h)*(1-f)+p*h*(1-f)+v*(1-h)*f+y*h*f}function Ye(i,t,e,n,s,o){return Pt(i,t,e,n,s,o)}function ue(i,t,e){const n=i.width/2,s=i.height/2,o=Math.min(i.width,i.height)/2,a=i.seaLevel*Dt;let c=Ye(i.heightmap,i.width,i.height,t,e,i.seaLevel)*Dt;const d=t-n,u=e-s,l=Math.sqrt(d*d+u*u),h=he(o,o*.88,l);c=a+(c-a)*h;const f=l*l/(2*Be);return c-=f,c}function fe(i,t,e){return Pt(i.slopeMap,i.width,i.height,t,e,.4)}function Ke(i,t,e,n,s){const o=n*.5,a=s*.5,r=[[t,e],[t-o,e-a],[t+o,e-a],[t-o,e+a],[t+o,e+a],[t,e-a],[t,e+a],[t-o,e],[t+o,e]];let c=Number.POSITIVE_INFINITY,d=Number.NEGATIVE_INFINITY,u=0;for(let l=0;l<r.length;l++){const h=ue(i,r[l][0],r[l][1]);c=Math.min(c,h),d=Math.max(d,h),u+=h}return{minY:c,maxY:d,avgY:u/r.length}}function Ve(i,t){const e=t.flat+t.shed+t.sawtooth,n=i()*e;return n<t.flat?"flat":n<t.flat+t.shed?"shed":"sawtooth"}function pe(i,t,e){const n=new ae(t,28),s=new re(n,new At({color:e,transparent:!0,opacity:.75}));i.add(s)}function Ze(i,t,e){return new L(new Q(Math.max(.26,i*.18),.08,Math.max(.14,t*.16)),new U({color:e}))}function $e(i,t,e,n,s,o,a,r){const c=Math.max(0,Math.floor(e*n*o/8));for(let d=0;d<c;d++){const u=M(t,.45,1.2),l=M(t,.45,1.2),h=M(t,.25,.75),f=M(t,-e*.34,e*.34),g=M(t,-n*.34,n*.34),p=new Q(u,h,l),v=new L(p,new U({color:a}));v.position.set(f,s+h*.5+.02,g),i.add(v);const y=new re(new ae(p,25),new At({color:r,transparent:!0,opacity:.6}));y.position.copy(v.position),i.add(y)}}function je(i,t,e,n,s,o,a){const r=Math.max(1,Math.floor(o*5));for(let c=0;c<r;c++){const d=M(t,.13,.3),u=M(t,1.2,2.8),l=new L(new ct(d,d,u,8),new U({color:a}));l.position.set(M(t,-e*.3,e*.3),s+u*.5,M(t,-n*.3,n*.3)),i.add(l)}}function qe(i,t,e,n,s,o,a,r,c,d){const u=t()<.5?-1:1;if(t()<d.siloChance){const l=M(t,.35,.75),h=s*M(t,1.15,1.85),f=u*(e*.5+l*1.15),g=M(t,-n*.24,n*.24),p=new ct(l,l*1.05,h,10),v=new L(p,new U({color:r}));v.position.set(f,h*.5,g),i.add(v),pe(i,p,c);const y=new L(new ct(l*1.04,l*.96,.15,10),new U({color:a}));y.position.set(f,h+.07,g),i.add(y)}if(t()<d.stackChance){const l=M(t,.12,.28),h=s*M(t,1.6,2.7),f=new L(new ct(l*.92,l,h,9),new U({color:a}));f.position.set(M(t,-e*.3,e*.3),o+h*.45,M(t,-n*.3,n*.3)),i.add(f)}if(t()<d.towerChance){const l=M(t,.45,.85),h=s*M(t,1.2,1.9),f=-u*(e*.5+l*.8),g=M(t,-n*.32,n*.32),p=new L(new Q(l,h,l),new U({color:d.towerColor}));p.position.set(f,h*.5,g),i.add(p);const v=new L(new Q(l*1.4,.12,l*1.4),new U({color:r}));v.position.set(f,h+.06,g),i.add(v)}if(t()<d.pipeChance){const l=M(t,.07,.14),h=e*M(t,.7,1.15),f=new L(new ct(l,l,h,8),new U({color:d.pipeColor}));f.rotation.z=Math.PI*.5,f.position.set(0,s*M(t,.28,.52),n*.54),i.add(f);const g=vt(t,1,3);for(let p=0;p<g;p++){const v=new L(new Q(M(t,.18,.35),M(t,.18,.32),M(t,.22,.35)),new U({color:a}));v.position.set(M(t,-h*.45,h*.45),f.position.y+M(t,-.12,.12),n*.54),i.add(v)}}if(t()<d.shedChance){const l=e*M(t,.28,.42),h=n*M(t,.28,.45),f=s*M(t,.38,.62),g=new L(new Q(l,f,h),new U({color:a}));g.position.set(u*(e*.5+l*.45),f*.5,-n*.18),i.add(g)}}function Qe(i,t,e,n,s,o,a){const r=new lt,c=s*M(t,i.floorHeight.min,i.floorHeight.max),d=Ve(t,i.roofWeights),u=new Q(e,c,n),l=new L(u,new U({color:i.color.wall}));l.position.y=c*.5,r.add(l),pe(r,u,i.color.edge);const h=new L(new Q(e*.95,o,n*.95),new U({color:4145988}));h.position.y=-o*.5+.01,r.add(h);const f=.16,g=c+f*.5,p=new U({color:i.color.roof});if(d==="flat"){const b=new Q(e*.98,f,n*.98),w=new L(b,p);w.position.y=g,r.add(w)}if(d==="shed"){const b=new Q(e*1.02,f,n*1.02),w=new L(b,p);w.position.y=g,w.rotation.z=M(t,-.12,.12),r.add(w)}if(d==="sawtooth"){const b=Math.max(2,Math.floor(e/2.2)),w=e/b;for(let P=0;P<b;P++){const R=new L(new Q(w*.95,f,n*.9),p);R.position.set(-e*.5+w*(P+.5),g+(P%2===0?.12:0),0),r.add(R)}}const v=a?a.moduleScale:1,y=M(t,i.rooftopModuleDensity.min,i.rooftopModuleDensity.max)*v;$e(r,t,e,n,c+f,y,i.color.wall,i.color.edge);const x=a?a.utilityScale:1,C=M(t,i.utilityDensity.min,i.utilityDensity.max)*x;i.districtType==="industrial"&&(je(r,t,e,n,c+f,C,i.color.wall),qe(r,t,e,n,c,c+f,i.color.wall,i.color.roof,i.color.edge,a??J.steelworks));const H=Ze(e,n,i.color.emissiveAccent);return H.position.set(0,Math.max(.5,c*.2),n*.51),r.add(H),r}function Je(i,t,e,n){const s=new ht(i.width*.5,i.height*.5),o=Math.min(i.width,i.height)*.5;let a=s.clone(),r=-1/0;for(let c=0;c<220;c++){const d=e()*Math.PI*2,u=Math.sqrt(e())*o*.68,l=s.x+Math.cos(d)*u,h=s.y+Math.sin(d)*u,f=ue(i,l,h),g=i.seaLevel*Dt;if(f<g+.8)continue;const p=fe(i,l,h),v=Pt(i.wetnessMap,i.width,i.height,l,h,.3),y=Pt(i.coverMap,i.width,i.height,l,h,.4);let x=0;if(t.districtType==="residential")x+=(1-p)*.58,x+=(1-v)*.18,x+=y*.14,x+=(f-g)*.01;else{const C=1-Z(Math.abs(f-g)/12,0,1);x+=(1-p)*.64,x+=C*.16,x+=v*.08,x+=(1-y)*.12}for(const C of n){const H=Math.hypot(C.x-l,C.y-h);x-=he(0,42,42-H)*.85}x>r&&(r=x,a.set(l,h))}return a}function Yt(i,t,e,n,s){const o=new lt;o.name=t.id;const a=Math.min(i.width,i.height)*.5,r=M(e,t.clusterRadius.min,t.clusterRadius.max),c=vt(e,t.buildingCount.min,t.buildingCount.max),d=[];for(let u=0;u<c;u++){let l=!1;for(let h=0;h<48&&!l;h++){const f=e()*Math.PI*2,g=Math.sqrt(e())*r,p=n.x+Math.cos(f)*g,v=n.y+Math.sin(f)*g;if(Math.hypot(p-i.width*.5,v-i.height*.5)>a*.9)continue;const x=vt(e,t.footprintWidth.min,t.footprintWidth.max),C=vt(e,t.footprintDepth.min,t.footprintDepth.max);if(fe(i,p,v)>.36)continue;const b=Ke(i,p,v,x,C),w=i.seaLevel*Dt;if(b.minY<w+.45)continue;const P=b.maxY-b.minY,R=.32+(x+C)*.045;if(P>R)continue;let G=!1;const D=(x+C)*.62+3.2;for(const F of d)if(Math.hypot(F.x-p,F.y-v)<D){G=!0;break}if(G)continue;const S=vt(e,t.floors.min,t.floors.max),X=Z(.18+P*.9,.2,.85),$=Qe(t,e,x,C,S,X,s);$.position.set(p,b.avgY-.03,v),$.rotation.y=Math.round(e()*3)*(Math.PI*.5),o.add($),d.push(new ht(p,v)),l=!0}}return o}function Qt(i){const t=Xt.find(e=>e.id===i);return t||Xt[0]}function Jt(i,t){const e=t();return i.type==="industrial"?e<.46?J.refinery:e<.84?J.steelworks:J.brickworks:i.type==="town"?e<.52?J.brickworks:e<.8?J.steelworks:J.refinery:e<.58?J.brickworks:e<.86?J.steelworks:J.refinery}function te(i,t,e){const n=Z(t.radius/14,.68,1.35),s=.9+e()*.2,o=n*s,a={...i.floors};let r={...i.roofWeights};return t.type==="village"&&(a.max=Math.max(1,Math.min(a.max,2))),t.type==="industrial"&&(r={flat:.22,shed:.2,sawtooth:.58}),{...i,id:`${i.id}-${t.id}`,buildingCount:{min:Math.max(4,Math.floor(i.buildingCount.min*o*.55)),max:Math.max(6,Math.floor(i.buildingCount.max*o*.8))},footprintWidth:{min:Math.max(2,Math.floor(i.footprintWidth.min*(.82+o*.08))),max:Math.max(3,Math.floor(i.footprintWidth.max*(.8+o*.12)))},footprintDepth:{min:Math.max(2,Math.floor(i.footprintDepth.min*(.82+o*.08))),max:Math.max(3,Math.floor(i.footprintDepth.max*(.8+o*.12)))},floors:a,roofWeights:r,rooftopModuleDensity:{min:Z(i.rooftopModuleDensity.min*(.8+o*.1),.04,.65),max:Z(i.rooftopModuleDensity.max*(.9+o*.15),.1,.9)},utilityDensity:{min:Z(i.utilityDensity.min*(.85+o*.12),.03,.8),max:Z(i.utilityDensity.max*(.95+o*.2),.08,1.2)},clusterRadius:{min:Z(t.radius*1.1,14,42),max:Z(t.radius*1.75,20,58)}}}function tn(i,t){const e=new lt,n=Qt("residential-blocks"),s=Qt("industrial-compound"),o=i.towns??[];for(let a=0;a<o.length;a++){const r=o[a],c=r.type==="industrial"?s:n,d=te(c,r,t),u=d.districtType==="industrial"?Jt(r,t):void 0,l=new ht(r.x,r.z),h=Yt(i,d,t,l,u);if(h.name=`town-${r.id}-${r.type}-primary`,h.userData.theme=(u==null?void 0:u.id)??"residential",e.add(h),!(r.type==="town"||r.type==="industrial"&&t()<.45))continue;const g=r.type==="industrial"?n:s,p={...r,id:`${r.id}-annex`,radius:r.radius*.62},v=te(g,p,t),y=v.districtType==="industrial"?Jt(p,t):void 0,x=t()*Math.PI*2,C=r.radius*(.65+t()*.45),H=new ht(r.x+Math.cos(x)*C,r.z+Math.sin(x)*C),b=Yt(i,v,t,H,y);b.name=`town-${r.id}-${r.type}-annex`,b.userData.theme=(y==null?void 0:y.id)??"residential",e.add(b)}return e}function en(i){const t=new lt;t.name="procedural-building-districts";const e=Xe(i)^186460723,n=Ue(e);if(i.towns&&i.towns.length>0)return t.add(tn(i,n)),t;const s=[];for(const o of Xt){const a=Je(i,o,n,s);s.push(a);const r=Yt(i,o,n,a);t.add(r)}return t}const nn=1.2,on=5e4,sn=32,Gt=90,an={federation:{frame:"#4080FF",fill:"#203060"},ataxian:{frame:"#E04020",fill:"#702010"},khroshi:{frame:"#C03050",fill:"#601828"},unknown:{frame:"#D09020",fill:"#685010"}},rn=5,cn=15e5,rt=64,pt=48,mt=5,ee=3,ne=32,ln=new Ut(65416);function dn(i){switch(i){case"federation":return"rectangle";case"khroshi":return"diamond";case"ataxian":return"hexagon";default:return"quatrefoil"}}function Bt(i,t,e){return`${i}:${t}:${e}`}function ie(i){return i.width*i.height*4}class hn{constructor(t){m(this,"scene");m(this,"cache",new Map);m(this,"cacheSizeBytes",0);m(this,"rendersThisFrame",0);m(this,"currentFrame",0);m(this,"selectionRingGeometry");m(this,"selectionRingMaterial");m(this,"_placeholderTexture",null);this.scene=t;const e=[];for(let n=0;n<=ne;n++){const s=n/ne*Math.PI*2;e.push(new q(Math.cos(s)*ee,.1,Math.sin(s)*ee))}this.selectionRingGeometry=new ce().setFromPoints(e),this.selectionRingMaterial=new At({color:ln,transparent:!0,opacity:.8})}resetFrameBudget(){this.rendersThisFrame=0,this.currentFrame++}createIcon(t){const e=new lt;e.name="unit-icon";const n=this._createIconSprite(t);n.name="icon-sprite",e.add(n);const s=this._createHealthBarSprite(t.crewCurrent,t.crewMax);s.name="health-sprite",e.add(s);const o=new Ie(this.selectionRingGeometry,this.selectionRingMaterial);return o.name="selection-ring",o.visible=t.isSelected,e.add(o),e}updateIcon(t,e){const n=t.getObjectByName("icon-sprite");if(n){const a=Bt(e.unitTypeId,e.faction,e.detectionTier);if(n.userData.cacheKey!==a){const c=this._getOrRenderIcon(e);c&&(n.material.map=c,n.material.needsUpdate=!0,n.userData.cacheKey=a)}}const s=t.getObjectByName("health-sprite");s&&this._updateHealthBarTexture(s,e.crewCurrent,e.crewMax);const o=t.getObjectByName("selection-ring");o&&(o.visible=e.isSelected)}dispose(){for(const t of this.cache.values())t.texture.dispose();this.cache.clear(),this.cacheSizeBytes=0,this.selectionRingGeometry.dispose(),this.selectionRingMaterial.dispose()}_createIconSprite(t){const e=this._getOrRenderIcon(t),n=new jt({map:e,transparent:!0,depthTest:!1,sizeAttenuation:!1}),s=new qt(n);return s.scale.set(.08,.08,1),s.position.set(0,5,0),s.userData={cacheKey:Bt(t.unitTypeId,t.faction,t.detectionTier)},s}_getOrRenderIcon(t){const e=Bt(t.unitTypeId,t.faction,t.detectionTier),n=this.cache.get(e);if(n)return n.lastUsedFrame=this.currentFrame,n.texture;if(this.rendersThisFrame>=rn)return this._getPlaceholderTexture();const s=this._renderIconCanvas(t),o=new Wt(s);o.minFilter=Ot,o.magFilter=Ot,this.rendersThisFrame++;const a={key:e,canvas:s,texture:o,lastUsedFrame:this.currentFrame};return this.cache.set(e,a),this.cacheSizeBytes+=ie(s),this._evictIfNeeded(),o}_renderIconCanvas(t){const e=document.createElement("canvas");e.width=rt,e.height=rt;const n=e.getContext("2d"),s=an[t.faction==="unknown"?"unknown":t.faction],o=dn(t.faction);n.clearRect(0,0,rt,rt);const a=rt/2,r=rt/2,c=rt*.35;switch(n.beginPath(),o){case"rectangle":n.rect(a-c,r-c*.7,c*2,c*1.4);break;case"diamond":n.moveTo(a,r-c),n.lineTo(a+c,r),n.lineTo(a,r+c),n.lineTo(a-c,r),n.closePath();break;case"hexagon":for(let d=0;d<6;d++){const u=Math.PI/3*d-Math.PI/6,l=a+c*Math.cos(u),h=r+c*Math.sin(u);d===0?n.moveTo(l,h):n.lineTo(l,h)}n.closePath();break;case"quatrefoil":for(let d=0;d<4;d++){const u=Math.PI/2*d,l=a+c*.9*Math.cos(u),h=r+c*.9*Math.sin(u);n.quadraticCurveTo(a+c*.5*Math.cos(u+Math.PI/4),r+c*.5*Math.sin(u+Math.PI/4),l,h)}n.closePath();break}switch(n.fillStyle=s.fill,n.fill(),n.strokeStyle=s.frame,n.lineWidth=2,n.stroke(),n.fillStyle=s.frame,n.textAlign="center",n.textBaseline="middle",t.detectionTier){case"SUSPECTED":n.font="bold 24px monospace",n.fillText("?",a,r);break;case"DETECTED":n.font="bold 12px monospace",n.fillText(this._unitClassAbbreviation(t.unitClass),a,r);break;case"CONFIRMED":n.font="bold 11px monospace",n.fillText(this._unitClassAbbreviation(t.unitClass),a,r-4),n.font="8px monospace",n.fillText(t.unitTypeId.substring(0,6),a,r+10);break;case"LOST":n.globalAlpha=.4,n.font="bold 18px monospace",n.fillText("X",a,r),n.globalAlpha=1;break}return e}_unitClassAbbreviation(t){return{mbt:"MBT",ifv:"IFV",apc:"APC",scout:"SCT",at_vehicle:"AT",aa_vehicle:"AA",arty_sp:"SPG",arty_towed:"ART",mortar:"MOR",support:"SUP",supply:"LOG",infantry:"INF",at_infantry:"ATI",aa_infantry:"AAI",engineer:"ENG",sniper:"SNP",hq:"HQ",helicopter_attack:"AH",helicopter_transport:"TH",fixed_wing:"FW"}[t]??"???"}_createHealthBarSprite(t,e){const n=this._renderHealthBarCanvas(t,e),s=new Wt(n);s.minFilter=Ot;const o=new jt({map:s,transparent:!0,depthTest:!1,sizeAttenuation:!1}),a=new qt(o);return a.scale.set(.05,.01,1),a.position.set(0,3.5,0),a.userData={canvas:n},a}_updateHealthBarTexture(t,e,n){const s=t.userData.canvas;this._renderHealthBarCanvas(e,n,s);const o=t.material;o.map&&(o.map.needsUpdate=!0)}_renderHealthBarCanvas(t,e,n){const s=n??document.createElement("canvas");s.width=pt,s.height=mt;const o=s.getContext("2d");o.clearRect(0,0,pt,mt),o.fillStyle="rgba(0, 0, 0, 0.6)",o.fillRect(0,0,pt,mt);const a=e>0?Math.max(0,t/e):0,r=Math.round(a*pt);return a>.66?o.fillStyle="#22cc44":a>.33?o.fillStyle="#cccc22":o.fillStyle="#cc2222",o.fillRect(0,0,r,mt),o.strokeStyle="rgba(200, 210, 210, 0.5)",o.lineWidth=1,o.strokeRect(0,0,pt,mt),s}_getPlaceholderTexture(){if(!this._placeholderTexture){const t=document.createElement("canvas");t.width=1,t.height=1,this._placeholderTexture=new Wt(t)}return this._placeholderTexture}_evictIfNeeded(){for(;this.cacheSizeBytes>cn&&this.cache.size>1;){let t=null,e=1/0;for(const[n,s]of this.cache)s.lastUsedFrame<e&&(e=s.lastUsedFrame,t=n);if(t){const n=this.cache.get(t);n.texture.dispose(),this.cacheSizeBytes-=ie(n.canvas),this.cache.delete(t)}else break}}}class un{constructor(t,e){m(this,"units",new Map);m(this,"contacts",new Map);m(this,"selectedIds",new Set);m(this,"scene");m(this,"camera");m(this,"raycaster",new le);m(this,"renderer");m(this,"localFaction","federation");m(this,"localPlayerId","");this.scene=t,this.camera=e,this.renderer=new hn(t)}setLocalPlayer(t,e){this.localPlayerId=t,this.localFaction=e}applyFullSnapshot(t,e){this.clearAll();for(const n of t)this.addUnit(n);for(const n of e)this.addContact(n)}applyUnitDeltas(t){for(const e of t){const n=this.units.get(e.unitId);n&&(e.posX!==void 0&&(n.posX=e.posX),e.posZ!==void 0&&(n.posZ=e.posZ),e.heading!==void 0&&(n.heading=e.heading),e.hp!==void 0&&(n.crewCurrent=e.hp),e.suppression!==void 0&&(n.suppression=e.suppression),e.destroyed!==void 0&&(n.isDestroyed=e.destroyed),n.sceneGroup.position.set(n.posX,0,n.posZ))}}applyContactDeltas(t){for(const e of t)switch(e.action){case"add":this.addContact({contactId:e.contactId,tier:e.tier??0,tierLabel:e.tierLabel??"SUSPECTED",posX:e.posX??0,posZ:e.posZ??0,unitClass:e.unitClass,heading:e.heading,lastSeenTick:e.lastSeenTick??0});break;case"update":{const n=this.contacts.get(e.contactId);if(!n)break;e.tierLabel!==void 0&&(n.tier=e.tierLabel),e.posX!==void 0&&(n.posX=e.posX),e.posZ!==void 0&&(n.posZ=e.posZ),e.unitClass!==void 0&&(n.unitClass=e.unitClass),e.heading!==void 0&&(n.heading=e.heading),e.lastSeenTick!==void 0&&(n.lastSeenTick=e.lastSeenTick),n.sceneGroup.position.set(n.posX,0,n.posZ);break}case"remove":this.removeContact(e.contactId);break}}addUnit(t){if(this.units.has(t.unitId))return;const e={unitTypeId:t.unitTypeId,unitClass:this._inferUnitClass(t.unitTypeId),faction:this.localFaction,detectionTier:"CONFIRMED",crewCurrent:t.crewCurrent,crewMax:t.crewMax,isSelected:!1,heading:t.heading},n=this.renderer.createIcon(e);n.position.set(t.posX,0,t.posZ),n.name=`unit-${t.unitId}`,this.scene.add(n);const s={unitId:t.unitId,unitTypeId:t.unitTypeId,ownerId:t.ownerId,faction:this.localFaction,unitClass:e.unitClass,posX:t.posX,posZ:t.posZ,heading:t.heading,crewCurrent:t.crewCurrent,crewMax:t.crewMax,suppression:t.suppression,isDestroyed:t.isDestroyed,sceneGroup:n,isSelected:!1};this.units.set(t.unitId,s)}addContact(t){if(this.contacts.has(t.contactId))return;const n={unitTypeId:t.contactId,unitClass:t.unitClass??"infantry",faction:"unknown",detectionTier:t.tierLabel,crewCurrent:1,crewMax:1,isSelected:!1,heading:t.heading??0},s=this.renderer.createIcon(n);let o=t.posX,a=t.posZ;t.tierLabel==="SUSPECTED"&&(o+=(Math.random()-.5)*100,a+=(Math.random()-.5)*100),s.position.set(o,0,a),s.name=`contact-${t.contactId}`,this.scene.add(s),this.contacts.set(t.contactId,{contactId:t.contactId,tier:t.tierLabel,posX:o,posZ:a,unitClass:t.unitClass,heading:t.heading,lastSeenTick:t.lastSeenTick,sceneGroup:s,isSelected:!1})}removeUnit(t){const e=this.units.get(t);e&&(this.scene.remove(e.sceneGroup),this.units.delete(t),this.selectedIds.delete(t))}removeContact(t){const e=this.contacts.get(t);e&&(this.scene.remove(e.sceneGroup),this.contacts.delete(t))}clearAll(){for(const t of this.units.values())this.scene.remove(t.sceneGroup);this.units.clear();for(const t of this.contacts.values())this.scene.remove(t.sceneGroup);this.contacts.clear(),this.selectedIds.clear()}selectUnit(t,e=!1){e||this.deselectAll();const n=this.units.get(t);n&&(n.isSelected=!0,this.selectedIds.add(t))}getAllUnits(){return Array.from(this.units.values())}addToSelection(t){const e=this.units.get(t);e&&(e.isSelected=!0,this.selectedIds.add(t))}selectMultiple(t){this.deselectAll();for(const e of t)this.addToSelection(e)}deselectAll(){for(const t of this.selectedIds){const e=this.units.get(t);e&&(e.isSelected=!1)}this.selectedIds.clear()}getSelectedIds(){return Array.from(this.selectedIds)}getSelectedUnits(){const t=[];for(const e of this.selectedIds){const n=this.units.get(e);n&&t.push(n)}return t}getUnitAtScreenPos(t,e){const n=new ht(t/window.innerWidth*2-1,-(e/window.innerHeight)*2+1);this.raycaster.setFromCamera(n,this.camera);const s=[];for(const a of this.units.values()){const r=a.sceneGroup.getObjectByName("icon-sprite");r&&(r.userData.pickId=a.unitId,r.userData.pickIsContact=!1,s.push(r))}for(const a of this.contacts.values()){const r=a.sceneGroup.getObjectByName("icon-sprite");r&&(r.userData.pickId=a.contactId,r.userData.pickIsContact=!0,s.push(r))}const o=this.raycaster.intersectObjects(s,!1);if(o.length>0){const a=o[0].object;return{unitId:a.userData.pickId,isContact:a.userData.pickIsContact}}return null}getUnitsInScreenRect(t,e,n,s){const o=[],a=Math.min(t,n),r=Math.max(t,n),c=Math.min(e,s),d=Math.max(e,s),u=new q;for(const l of this.units.values()){if(l.ownerId!==this.localPlayerId)continue;u.set(l.posX,0,l.posZ),u.project(this.camera);const h=(u.x*.5+.5)*window.innerWidth,f=(-u.y*.5+.5)*window.innerHeight;h>=a&&h<=r&&f>=c&&f<=d&&o.push(l.unitId)}return o}updateFrame(){this.renderer.resetFrameBudget();for(const t of this.units.values())this.renderer.updateIcon(t.sceneGroup,{unitTypeId:t.unitTypeId,unitClass:t.unitClass,faction:t.faction,detectionTier:"CONFIRMED",crewCurrent:t.crewCurrent,crewMax:t.crewMax,isSelected:t.isSelected,heading:t.heading});for(const t of this.contacts.values())this.renderer.updateIcon(t.sceneGroup,{unitTypeId:t.contactId,unitClass:t.unitClass??"infantry",faction:"unknown",detectionTier:t.tier,crewCurrent:1,crewMax:1,isSelected:t.isSelected,heading:t.heading??0})}getUnit(t){return this.units.get(t)}getContact(t){return this.contacts.get(t)}getUnitCount(){return this.units.size}getContactCount(){return this.contacts.size}dispose(){this.clearAll(),this.renderer.dispose()}_inferUnitClass(t){const e=t.toUpperCase();return e.includes("ABRAMS")||e.includes("MBT")||e.includes("LEOPARD")||e.includes("T-")&&e.match(/T-\d/)?"mbt":e.includes("BRADLEY")||e.includes("IFV")||e.includes("BMP")?"ifv":e.includes("APC")||e.includes("STRYKER")||e.includes("BTR")?"apc":e.includes("SCOUT")||e.includes("RECON")?"scout":e.includes("JAVELIN")||e.includes("TOW")||e.includes("AT_VEH")?"at_vehicle":e.includes("AA_VEH")||e.includes("AVENGER")||e.includes("GEPARD")?"aa_vehicle":e.includes("PALADIN")||e.includes("SPG")||e.includes("ARTY_SP")?"arty_sp":e.includes("HOWITZER")||e.includes("ARTY_TOW")?"arty_towed":e.includes("MORTAR")?"mortar":e.includes("SUPPLY")||e.includes("LOGISTICS")?"supply":e.includes("HQ")||e.includes("COMMAND")?"hq":e.includes("SNIPER")?"sniper":e.includes("ENGINEER")||e.includes("SAPPER")?"engineer":e.includes("AT_INF")||e.includes("ANTI_TANK")||e.includes("ANTI-TANK")?"at_infantry":e.includes("AA_INF")||e.includes("MANPAD")||e.includes("STINGER")?"aa_infantry":e.includes("INFANTRY")||e.includes("RIFLE")||e.includes("SQUAD")?"infantry":e.includes("APACHE")||e.includes("ATTACK_HELO")||e.includes("HELO_ATK")?"helicopter_attack":e.includes("BLACKHAWK")||e.includes("TRANSPORT_HELO")||e.includes("HELO_TRN")?"helicopter_transport":e.includes("FIXED_WING")||e.includes("F-")||e.includes("A-10")?"fixed_wing":e.includes("SUPPORT")?"support":"infantry"}}const fn=8;class pn{constructor(t,e,n){m(this,"callbacks");m(this,"camera");m(this,"raycaster",new le);m(this,"terrainMesh",null);m(this,"pickUnitAtScreen");m(this,"isDragging",!1);m(this,"dragStartX",0);m(this,"dragStartY",0);m(this,"dragCurrentX",0);m(this,"dragCurrentY",0);m(this,"leftButtonDown",!1);m(this,"boxOverlay");m(this,"_onMouseDown");m(this,"_onMouseMove");m(this,"_onMouseUp");m(this,"_onKeyDown");this.camera=t,this.callbacks=e,this.pickUnitAtScreen=n,this.boxOverlay=document.createElement("div"),this.boxOverlay.style.cssText=`
      position: fixed;
      border: 1px solid rgba(0, 255, 136, 0.7);
      background: rgba(0, 255, 136, 0.1);
      pointer-events: none;
      display: none;
      z-index: 100;
    `,document.body.appendChild(this.boxOverlay),this._onMouseDown=this.handleMouseDown.bind(this),this._onMouseMove=this.handleMouseMove.bind(this),this._onMouseUp=this.handleMouseUp.bind(this),this._onKeyDown=this.handleKeyDown.bind(this),window.addEventListener("mousedown",this._onMouseDown),window.addEventListener("mousemove",this._onMouseMove),window.addEventListener("mouseup",this._onMouseUp),window.addEventListener("keydown",this._onKeyDown)}setTerrainMesh(t){this.terrainMesh=t}handleMouseDown(t){t.button===0&&(this.leftButtonDown=!0,this.dragStartX=t.clientX,this.dragStartY=t.clientY,this.dragCurrentX=t.clientX,this.dragCurrentY=t.clientY,this.isDragging=!1),t.button===2&&this.handleRightClick(t)}handleMouseMove(t){if(!this.leftButtonDown)return;this.dragCurrentX=t.clientX,this.dragCurrentY=t.clientY;const e=this.dragCurrentX-this.dragStartX,n=this.dragCurrentY-this.dragStartY;Math.sqrt(e*e+n*n)>fn&&(this.isDragging=!0,this.updateBoxOverlay())}handleMouseUp(t){t.button===0&&(this.leftButtonDown=!1,this.isDragging?(this.isDragging=!1,this.boxOverlay.style.display="none",this.callbacks.onBoxSelect({x1:this.dragStartX,y1:this.dragStartY,x2:this.dragCurrentX,y2:this.dragCurrentY})):this.handleLeftClick(t))}handleLeftClick(t){const e=t.ctrlKey||t.shiftKey,n=this.pickUnitAtScreen(t.clientX,t.clientY);n?this.callbacks.onSelect(n.unitId,n.isContact,e):e||this.callbacks.onSelect(null,!1,!1)}handleRightClick(t){const e=t.shiftKey,n=this.pickUnitAtScreen(t.clientX,t.clientY);if(n&&n.isContact){this.callbacks.onEngageOrder(n.unitId,e);return}const s=this.raycastTerrain(t.clientX,t.clientY);s&&this.callbacks.onMoveOrder(s,e)}handleKeyDown(t){if(!t.repeat&&!(t.target instanceof HTMLInputElement||t.target instanceof HTMLTextAreaElement))switch(t.code){case"Digit1":this.callbacks.onFirePostureChange("free_fire");break;case"Digit2":this.callbacks.onFirePostureChange("return_fire");break;case"Digit3":this.callbacks.onFirePostureChange("hold_fire");break;case"Digit4":this.callbacks.onMoveModeChange("advance");break;case"KeyE":this.callbacks.onSpecialOrder("entrench");break;case"KeyK":this.callbacks.onSpecialOrder("deploy_smoke");break;case"KeyR":this.callbacks.onSpecialOrder("rally");break}}raycastTerrain(t,e){const n=new ht(t/window.innerWidth*2-1,-(e/window.innerHeight)*2+1);if(this.raycaster.setFromCamera(n,this.camera),this.terrainMesh){const r=this.raycaster.intersectObject(this.terrainMesh,!0);if(r.length>0){const c=r[0].point;return{x:c.x,z:c.z}}}const s=new Te(new q(0,1,0),0),o=new q;return this.raycaster.ray.intersectPlane(s,o)?{x:o.x,z:o.z}:null}updateBoxOverlay(){const t=Math.min(this.dragStartX,this.dragCurrentX),e=Math.min(this.dragStartY,this.dragCurrentY),n=Math.abs(this.dragCurrentX-this.dragStartX),s=Math.abs(this.dragCurrentY-this.dragStartY);this.boxOverlay.style.left=`${t}px`,this.boxOverlay.style.top=`${e}px`,this.boxOverlay.style.width=`${n}px`,this.boxOverlay.style.height=`${s}px`,this.boxOverlay.style.display="block"}dispose(){window.removeEventListener("mousedown",this._onMouseDown),window.removeEventListener("mousemove",this._onMouseMove),window.removeEventListener("mouseup",this._onMouseUp),window.removeEventListener("keydown",this._onKeyDown),this.boxOverlay.parentElement&&this.boxOverlay.parentElement.removeChild(this.boxOverlay)}}const mn=[[0,-1,1],[1,-1,1.4142],[1,0,1],[1,1,1.4142],[0,1,1],[-1,1,1.4142],[-1,0,1],[-1,-1,1.4142]];class gn{constructor(){m(this,"data",[])}get size(){return this.data.length}push(t){this.data.push(t),this._bubbleUp(this.data.length-1)}pop(){if(this.data.length===0)return;const t=this.data[0],e=this.data.pop();return this.data.length>0&&(this.data[0]=e,this._sinkDown(0)),t}_bubbleUp(t){for(;t>0;){const e=t-1>>1;if(this.data[t].f<this.data[e].f)[this.data[t],this.data[e]]=[this.data[e],this.data[t]],t=e;else break}}_sinkDown(t){const e=this.data.length;for(;;){let n=t;const s=2*t+1,o=2*t+2;if(s<e&&this.data[s].f<this.data[n].f&&(n=s),o<e&&this.data[o].f<this.data[n].f&&(n=o),n!==t)[this.data[t],this.data[n]]=[this.data[n],this.data[t]],t=n;else break}}}function oe(i,t,e,n){const s=Math.abs(i-e),o=Math.abs(t-n);return Math.max(s,o)+(1.4142-1)*Math.min(s,o)}class vn{constructor(){m(this,"costGrid",null);m(this,"previewLine",null);m(this,"previewMaterial");this.previewMaterial=new At({color:65416,transparent:!0,opacity:.7,linewidth:2})}setCostGrid(t){this.costGrid=t}findPath(t,e,n,s){if(!this.costGrid)return{status:"FOUND",path:[t,e],rawPath:[t,e],nodesExpanded:0,costTotal:this._straightLineDistance(t,e)};const o=this.costGrid,a=o.cellSizeM,r=Math.round(t.x/a),c=Math.round(t.z/a),d=Math.round(e.x/a),u=Math.round(e.z/a),l=(F,W)=>Math.max(0,Math.min(W-1,F)),h=l(r,o.width),f=l(c,o.height),g=l(d,o.width),p=l(u,o.height);if(o.data[p*o.width+g]>=Gt)return{status:"NOT_FOUND",path:[],rawPath:[],nodesExpanded:0,costTotal:0};const y=nn,x=on,C=new gn,H=[],b=new Set,w=(F,W)=>F*o.height+W,P=new Map,R={gx:h,gz:f,g:0,f:y*oe(h,f,g,p),parentIndex:-1};C.push(R),P.set(w(h,f),0);let G=0,D=null;for(;C.size>0&&G<x;){const F=C.pop(),W=w(F.gx,F.gz);if(b.has(W))continue;b.add(W);const O=H.length;if(H.push(F),G++,F.gx===g&&F.gz===p){D=F;break}for(const[at,I,T]of mn){const z=F.gx+at,k=F.gz+I;if(z<0||z>=o.width||k<0||k>=o.height)continue;const E=w(z,k);if(b.has(E))continue;const N=o.data[k*o.width+z];if(N>=Gt)continue;const A=N*T,Y=F.g+A,K=P.get(E);if(K!==void 0&&Y>=K)continue;P.set(E,Y);const _=oe(z,k,g,p),B={gx:z,gz:k,g:Y,f:Y+y*_,parentIndex:O};C.push(B)}}if(!D)return{status:"NOT_FOUND",path:[],rawPath:[],nodesExpanded:G,costTotal:0};const S=[];let X=D;for(;X;)S.push({x:X.gx*a,z:X.gz*a}),X=X.parentIndex>=0?H[X.parentIndex]:null;return S.reverse(),{status:"FOUND",path:this._smoothPath(S,o),rawPath:S,nodesExpanded:G,costTotal:D.g}}showPathPreview(t,e,n=.5,s){if(this.clearPathPreview(t),e.length<2)return;const o=e.map(r=>{const c=s?s(r.x,r.z)+n:n;return new q(r.x,c,r.z)}),a=new ce().setFromPoints(o);this.previewLine=new De(a,this.previewMaterial),this.previewLine.name="path-preview",t.add(this.previewLine)}clearPathPreview(t){this.previewLine&&(t.remove(this.previewLine),this.previewLine.geometry.dispose(),this.previewLine=null)}dispose(){this.previewMaterial.dispose(),this.previewLine&&this.previewLine.geometry.dispose()}_smoothPath(t,e){if(t.length<=2)return[...t];const n=[t[0]];let s=0;for(;s<t.length-1;){let o=s+1;const a=Math.min(s+sn,t.length-1);for(let r=a;r>s+1;r--)if(this._lineOfWalk(t[s],t[r],e)){o=r;break}n.push(t[o]),s=o}return n}_lineOfWalk(t,e,n){const s=n.cellSizeM;let o=Math.round(t.x/s),a=Math.round(t.z/s);const r=Math.round(e.x/s),c=Math.round(e.z/s),d=Math.abs(r-o),u=Math.abs(c-a),l=o<r?1:-1,h=a<c?1:-1;let f=d-u;for(;;){if(o<0||o>=n.width||a<0||a>=n.height||n.data[a*n.width+o]>=Gt)return!1;if(o===r&&a===c)break;const g=2*f;g>-u&&(f-=u,o+=l),g<d&&(f+=d,a+=h)}return!0}_straightLineDistance(t,e){const n=t.x-e.x,s=t.z-e.z;return Math.sqrt(n*n+s*s)}}const ut=new Pe({antialias:!0});ut.setSize(window.innerWidth,window.innerHeight);ut.setPixelRatio(window.devicePixelRatio);ut.setClearColor(0);document.body.appendChild(ut.domElement);const st=new ke,it=new Ee(window.innerWidth/window.innerHeight);window.addEventListener("resize",()=>{ut.setSize(window.innerWidth,window.innerHeight),it.resize(window.innerWidth/window.innerHeight)});const Kt=document.createElement("div");Kt.style.cssText=`
  position: fixed;
  top: 12px;
  left: 12px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  letter-spacing: 0.05em;
  color: rgba(200, 210, 210, 0.85);
  background: rgba(8, 10, 10, 0.62);
  border: 1px solid rgba(128, 255, 216, 0.25);
  padding: 8px 10px;
  pointer-events: none;
  user-select: none;
`;Kt.innerHTML=["LEFT CLICK = SELECT UNIT","RIGHT CLICK = MOVE ORDER","SHIFT+RIGHT CLICK = QUEUE WAYPOINT","G = REGEN TERRAIN | SHIFT+G = HI-RES"].join("<br>");document.body.appendChild(Kt);const kt=new Ae;let gt=null,Tt=null,me=null;const V=new un(st,it.camera);V.setLocalPlayer("player1","federation");const Et=new vn,et=new Map,wn={onSelect(i,t,e){e||V.deselectAll(),i&&V.selectUnit(i,e)},onMoveOrder(i,t){const e=V.getSelectedIds();if(e.length!==0)for(const n of e){const s=V.getUnit(n);if(!s)continue;const o={x:s.posX,z:s.posZ},a=Et.findPath(o,i,"track");if(a.status==="FOUND"&&a.path.length>=2){if(t){const c=et.get(n);if(c&&c.pathIndex<c.path.length){const u=c.path.slice(c.pathIndex).concat(a.path.slice(1));et.set(n,{path:u,pathIndex:0})}else et.set(n,{path:a.path,pathIndex:0})}else et.set(n,{path:a.path,pathIndex:0});const r=et.get(n);Et.showPathPreview(st,r.path,.5,(c,d)=>it.getTerrainHeight(c,d))}}},onEngageOrder(i,t){},onBoxSelect(i){const t=V.getUnitsInScreenRect(i.x1,i.y1,i.x2,i.y2);V.deselectAll();for(const e of t)V.selectUnit(e,!0)},onFirePostureChange(i){},onMoveModeChange(i){},onSpecialOrder(i){}},Mn=new pn(it.camera,wn,(i,t)=>V.getUnitAtScreenPos(i,t));kt.on("terrain",i=>{var l;console.log(`Received terrain — biome: ${i.data.biome}`),me=i.data,gt&&st.remove(gt),Tt&&st.remove(Tt),gt=Ge(i.data),st.add(gt),Tt=en(i.data),st.add(Tt),it.setTerrainData(i.data,52);const t=gt.getObjectByName("terrain-surface");t&&Mn.setTerrainMesh(t);const{width:e,height:n,resolution:s}=i.data,o=new Float32Array(e*n);for(let h=0;h<e*n;h++){if(i.data.heightmap[h]<=i.data.seaLevel){o[h]=95;continue}const g=((l=i.data.slopeMap)==null?void 0:l[h])??0;g>.85?o[h]=95:o[h]=1+g*4}Et.setCostGrid({data:o,width:e,height:n,cellSizeM:s}),V.clearAll(),et.clear(),Et.clearPathPreview(st);let a=Math.floor(i.data.width/2),r=Math.floor(i.data.height/2);const c=i.data.seaLevel,d=i.data.heightmap;let u=!1;for(let h=0;h<Math.max(e,n)/2&&!u;h++)for(let f=-h;f<=h&&!u;f++)for(let g=-h;g<=h&&!u;g++){if(Math.abs(f)!==h&&Math.abs(g)!==h)continue;const p=Math.floor(e/2)+f,v=Math.floor(n/2)+g;p<0||p>=e||v<0||v>=n||d[v*e+p]>c&&(a=p,r=v,u=!0)}V.applyFullSnapshot([{unitId:"test-unit-1",unitTypeId:"M1_ABRAMS",ownerId:"player1",posX:a,posZ:r,heading:0,crewCurrent:4,crewMax:4,suppression:0,moraleState:"normal",speedState:"full_halt",firePosture:"return_fire",ammo:[],isDestroyed:!1,isEntrenched:!1}],[]),console.log(`Test unit spawned at (${a.toFixed(0)}, ${r.toFixed(0)})`)});kt.connect();window.addEventListener("keydown",i=>{if(i.code!=="KeyG"||i.repeat)return;const t=Math.random()*1e6;if(i.shiftKey){console.log(`Requesting HI-RES terrain seed=${t.toFixed(0)} (640x640)`),kt.send("generate",{seed:t,width:640,height:640});return}console.log(`Requesting terrain seed=${t.toFixed(0)}`),kt.send("generate",{seed:t})});const yn=8;function xn(i){if(me){for(const[t,e]of et){const n=V.getUnit(t);if(!n||n.isDestroyed){et.delete(t);continue}if(e.pathIndex>=e.path.length){et.delete(t);continue}const s=e.path[e.pathIndex],o=s.x-n.posX,a=s.z-n.posZ,r=Math.sqrt(o*o+a*a),c=yn*i;if(c>=r)n.posX=s.x,n.posZ=s.z,e.pathIndex++;else{const u=c/r;n.posX+=o*u,n.posZ+=a*u,n.heading=Math.atan2(o,a)*(180/Math.PI),n.heading<0&&(n.heading+=360)}const d=it.getTerrainHeight(n.posX,n.posZ);n.sceneGroup.position.set(n.posX,d,n.posZ)}for(const t of V.getAllUnits()){if(et.has(t.unitId))continue;const e=it.getTerrainHeight(t.posX,t.posZ);t.sceneGroup.position.set(t.posX,e,t.posZ)}}}let se=performance.now();function ge(){requestAnimationFrame(ge);const i=performance.now(),t=Math.min((i-se)/1e3,.1);se=i,it.update(t),xn(t),V.updateFrame(),ut.render(st,it.camera)}ge();
