import {describe,expect,it,vi,afterEach} from 'vitest';
vi.mock('@workspace/db',()=>({db:{},creativesTable:{}}));
import {normalizedVariantAttrs,variantAttributesFromValues} from '../src/services/variant-attributes';
import {fetchMetaMarketingData} from '../src/services/meta-ads';
afterEach(()=>vi.unstubAllGlobals());
describe('cross-brand variation formats',()=>{
 it('keeps Giah composite sizes intact and repairs older split colors',()=>{
  expect(variantAttributesFromValues(['P / 38','AZUL'])).toEqual({color:'AZUL',size:'P / 38'});
  expect(normalizedVariantAttrs({color:'38 / AZUL',size:'P'})).toEqual({color:'AZUL',size:'P / 38'});
  expect(normalizedVariantAttrs({color:'38 / AZUL',size:'P / 38'})).toEqual({color:'AZUL',size:'P / 38'});
  expect(normalizedVariantAttrs({color:'P / 38',size:'AZUL'})).toEqual({color:'AZUL',size:'P / 38'});
 });
 it('does not split cosmetic shade expiry dates into sizes',()=>{
  expect(variantAttributesFromValues(['#13 Shy Pear (VAL 02/2027)'])).toEqual({color:'#13 Shy Pear (VAL 02/2027)',size:null});
  expect(normalizedVariantAttrs({color:'#13 Shy Pear (VAL 02',size:'2027)'})).toEqual({color:'#13 Shy Pear (VAL 02/2027)',size:null});
 });
});
describe('native Meta reports for larger B2C accounts',()=>{
 it('reads daily account totals separately from period ad totals without requesting ad-by-day expansion',async()=>{
  const day={spend:'100',impressions:'1000',clicks:'20',actions:[{action_type:'purchase',value:'2'},{action_type:'omni_purchase',value:'2'}],action_values:[{action_type:'purchase',value:'300'}]};
  const fetch=vi.fn(async(input:RequestInfo|URL)=>{
   const url=new URL(String(input));let data:unknown[]=[];
   if(url.pathname.endsWith('/insights')){
    if(url.searchParams.get('level')==='account')data=[{...day,date_start:'2026-10-19',date_stop:'2026-10-19'},{...day,date_start:'2026-10-20',date_stop:'2026-10-20'}];
    else{expect(url.searchParams.has('time_increment')).toBe(false);data=[{...day,spend:'200',actions:[{action_type:'purchase',value:'4'}],action_values:[{action_type:'purchase',value:'600'}],ad_id:'ad',campaign_id:'campaign',date_start:'2026-10-19',date_stop:'2026-10-20'}];}
   }
   return new Response(JSON.stringify({data}),{status:200});
  });vi.stubGlobal('fetch',fetch);
  const result=await fetchMetaMarketingData({accessToken:'large-fixture',adAccountId:'large-account',since:'2026-10-19',until:'2026-10-20',isB2C:true,includeMedia:false});
  expect(result.summary).toMatchObject({spend:200,purchases:4,revenue:600});
  expect(result.ads[0]).toMatchObject({spend:200,purchases:4,dateStop:'2026-10-20'});
  expect(result.daily).toHaveLength(2);
 });
});
