import { describe, expect, it } from 'vitest';
import { brazilState, regionalCommerceMarketing } from '../src/services/regional-marketing';
describe('regional commerce MER',()=>{
 it('matches Meta region names to order UFs without allocating total spend proportionally',()=>{
  const rows=regionalCommerceMarketing([{state:'SP',purchases:5,paidRevenue:500},{state:'RJ',purchases:2,paidRevenue:100}], [{state:'São Paulo (state)',spend:100},{state:'Rio de Janeiro (state)',spend:50}]);
  expect(rows[0]).toMatchObject({state:'SP',purchases:5,paidRevenue:500,spend:100,mer:5});
  expect(rows[1]).toMatchObject({state:'RJ',purchases:2,spend:50,mer:2});
 });
 it('missing regional spend or zero investment never becomes fake zero return',()=>{
  const purchases=[{state:'PE',purchases:3,paidRevenue:90}];
  expect(regionalCommerceMarketing(purchases,undefined)[0]).toMatchObject({purchases:3,spend:null,mer:null});
  expect(regionalCommerceMarketing(purchases,[{state:'Pernambuco',spend:0}])[0]).toMatchObject({spend:0,mer:null});
 });
 it('keeps unknown order location and excludes non-Brazil regions from the match',()=>{
  expect(brazilState('Treinta y Tres Department')).toBeNull();
  expect(brazilState('Federal District')).toBe('DF');
  const rows=regionalCommerceMarketing([{state:null,purchases:1,paidRevenue:50}], [{state:'Sao Paulo',spend:30}]);
  expect(rows).toContainEqual(expect.objectContaining({state:'Não informado',purchases:1,mer:null}));
  expect(rows).toContainEqual(expect.objectContaining({state:'SP',purchases:0,spend:30,mer:0}));
 });
});
