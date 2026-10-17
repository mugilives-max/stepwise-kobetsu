// Cabinet Office calendar checked 2026-10-17: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
import { shiftMonth } from './plan-calc.mjs';
const days={
2026:'01-01 01-12 02-11 02-23 03-20 04-29 05-03 05-04 05-05 05-06 07-20 08-11 09-21 09-22 09-23 10-12 11-03 11-23',
2027:'01-01 01-11 02-11 02-23 03-21 03-22 04-29 05-03 05-04 05-05 07-19 08-11 09-20 09-23 10-11 11-03 11-23'
};
export function calendarKnown(year){return !!days[year];}
export function bankClosed(date){
 const d=new Date(date+'T00:00:00Z'),md=date.slice(5);
 return [0,6].includes(d.getUTCDay())||['01-01','01-02','01-03','12-31'].includes(md)||(days[date.slice(0,4)]||'').split(' ').includes(md);
}
export function payrollPayOn(month){
 const d=new Date(shiftMonth(month,1)+'-25T00:00:00Z');
 while(bankClosed(d.toISOString().slice(0,10)))d.setUTCDate(d.getUTCDate()-1);
 return d.toISOString().slice(0,10);
}
