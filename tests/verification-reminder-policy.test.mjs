import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowVerificationReminder as show } from '../src/utils/verificationReminderPolicy.ts';
const now=Date.UTC(2026,10,9), day=86400000;
const created=age=>new Date(now-age*day).toISOString();
test('in-app nudge begins after final email window, including old accounts',()=>{
 assert.equal(show(created(10),[{}],false,now),false);
 assert.equal(show(created(11),[{}],false,now),true);
 assert.equal(show(created(100),[{}],false,now),true);
 assert.equal(show(undefined,[{}],false,now),false);
 assert.equal(show(created(11),[],false,now),false);
});
test('never nags submitted, pending, rejected or verified students in either role',()=>{
 for(const profile of [{isVerified:true},{verificationSubmittedAt:1},{lastVerificationId:'v'},...['submitted','manual-review','pending_review','approved','auto-approved','under-review','rejected','denied'].map(verificationStatus=>({verificationStatus}))]){
 assert.equal(show(created(11),[{},profile],false,now),false);
 }
 assert.equal(show(created(11),[{}],true,now),false);
 assert.equal(show(created(11),[{verificationStatus:'verified'}],false,now),true);
});
