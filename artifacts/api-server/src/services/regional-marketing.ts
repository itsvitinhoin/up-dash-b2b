const STATES: Record<string,string> = {
  acre:'AC', alagoas:'AL', amapa:'AP', amazonas:'AM', bahia:'BA', ceara:'CE', 'distrito federal':'DF', 'federal district':'DF', 'espirito santo':'ES', goias:'GO', maranhao:'MA', 'mato grosso':'MT', 'mato grosso do sul':'MS', 'minas gerais':'MG', para:'PA', paraiba:'PB', parana:'PR', pernambuco:'PE', piaui:'PI', 'rio de janeiro':'RJ', 'rio grande do norte':'RN', 'rio grande do sul':'RS', rondonia:'RO', roraima:'RR', 'santa catarina':'SC', 'sao paulo':'SP', sergipe:'SE', tocantins:'TO'
};
export function brazilState(value: string | null): string | null {
  const key=(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s*\(state\)\s*$/i,'').trim().toLowerCase();
  return STATES[key] ?? (Object.values(STATES).includes(key.toUpperCase()) ? key.toUpperCase() : null);
}
export function regionalCommerceMarketing(orders: Array<{state:string|null;purchases:number;paidRevenue:number}>, regions: Array<{state:string;spend:number}> | undefined) {
  const spendByState=new Map<string,number>();
  for(const row of regions ?? []) { const uf=brazilState(row.state); if(uf) spendByState.set(uf,(spendByState.get(uf) ?? 0)+row.spend); }
  const totals=new Map<string,{purchases:number;paidRevenue:number}>();
  for(const row of orders) { const uf=brazilState(row.state) ?? 'Não informado'; const total=totals.get(uf) ?? {purchases:0,paidRevenue:0}; total.purchases+=row.purchases; total.paidRevenue+=row.paidRevenue; totals.set(uf,total); }
  for(const uf of spendByState.keys()) if(!totals.has(uf)) totals.set(uf,{purchases:0,paidRevenue:0});
  return [...totals].map(([state,total])=>{ const spend=regions === undefined || state === 'Não informado' ? null : spendByState.get(state) ?? null;
    return {state,leads:total.purchases,attributedRevenue:total.paidRevenue,roas:0,purchases:total.purchases,paidRevenue:total.paidRevenue,spend,mer:spend != null && spend>0 ? total.paidRevenue/spend : null};
  }).sort((a,b)=>(b.mer ?? -1)-(a.mer ?? -1) || b.paidRevenue-a.paidRevenue);
}
