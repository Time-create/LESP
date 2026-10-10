function references(content) {
  const ids=[];
  function walk(node){if(node.attrs?.citationId)ids.push(node.attrs.citationId);for(const child of node.content||[])walk(child);}
  walk(content); return ids;
}
function markFor(n){return n<=20?String.fromCharCode(0x245f+n):'('+n+')';}
module.exports={references,markFor};
