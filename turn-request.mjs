// Read only user-authored text from one exact Codex turn; never fall back to chat previews.
export function extractTurnRequest(rows,turnId){
 const messages=rows.filter(row=>!row.turnId||row.turnId===turnId).map(row=>row.item||row).filter(item=>item.type==='userMessage').reverse().map(item=>({clientId:item.clientId||null,text:typeof item.text==='string'?item.text:(item.content||[]).filter(c=>c.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n')})).filter(m=>m.text);
 return {turnId,messages,text:messages.map(m=>m.text).join('\n\n'),status:messages.length?'available':'unavailable'};
}
