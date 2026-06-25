const navLinks = [...document.querySelectorAll('.top-nav a')];
const sections = navLinks.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
function setActiveNav(){const y=scrollY+110;let active=sections[0]?.id;sections.forEach(s=>{if(s.offsetTop<=y) active=s.id});navLinks.forEach(a=>a.classList.toggle('active',a.getAttribute('href')===`#${active}`))}
addEventListener('scroll', setActiveNav, {passive:true}); setActiveNav();

const lightbox=document.querySelector('.lightbox');
const lbImg=lightbox.querySelector('img');
const lbTitle=lightbox.querySelector('.lightbox-title');
document.querySelectorAll('[data-src]').forEach(card=>{
  card.addEventListener('click',()=>{
    lbImg.src=card.dataset.src;
    lbTitle.textContent=card.dataset.title || '';
    lightbox.classList.add('show');
    lightbox.setAttribute('aria-hidden','false');
  });
});
function closeLightbox(){lightbox.classList.remove('show');lightbox.setAttribute('aria-hidden','true');lbImg.src=''}
document.querySelector('.lightbox-close').addEventListener('click',closeLightbox);
lightbox.addEventListener('click',e=>{if(e.target===lightbox)closeLightbox()});
addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox()});

const backTop=document.querySelector('.back-top');
addEventListener('scroll',()=>backTop.classList.toggle('show',scrollY>600),{passive:true});
backTop.addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));

window.HeatTreatmentManualV163 = {
  version:'1.6.3',
  screenshots: () => [...document.querySelectorAll('.shot-card,.shot-mini')].map(x=>({title:x.dataset.title,src:x.dataset.src})),
  pdfPages: () => [...document.querySelectorAll('.pdf-card')].map(x=>({title:x.dataset.title,src:x.dataset.src}))
};
