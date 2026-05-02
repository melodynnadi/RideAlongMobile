import 'react-native-get-random-values';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  ActivityIndicator,
  useColorScheme,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { firestore, firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { addDoc, collection, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import * as Location from 'expo-location';
import { PaymentModal } from '@/components/PaymentModal';
import { checkCanRequestRide } from '@/services/verification';
import { computeBaseFare } from '@/utils/fees';

// ─── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  orange:      '#F4621F',
  orangeLight: '#FF8C4A',
  orangeGlow:  'rgba(244,98,31,0.18)',
  orangeBorder:'rgba(244,98,31,0.40)',
  green:       '#10B981',
  red:         '#EF4444',
  dkBg:        '#080E17',
  dkBg2:       '#0D1620',
  dkBg3:       '#111E2C',
  dkCard:      'rgba(255,255,255,0.07)',
  dkBorder:    'rgba(255,255,255,0.12)',
  dkText:      '#F0F4FF',
  dkSub:       '#7A8FA8',
  dkInput:     'rgba(255,255,255,0.08)',
  dkInputBdr:  'rgba(255,255,255,0.14)',
  ltBg:        '#EEF1F7',
  ltCard:      'rgba(255,255,255,0.85)',
  ltBorder:    'rgba(255,255,255,0.9)',
  ltText:      '#0D1B2A',
  ltSub:       '#5A6A7E',
  ltInput:     'rgba(255,255,255,0.95)',
  ltInputBdr:  'rgba(200,210,225,0.9)',
};

function useT() {
  const dark = useColorScheme() === 'dark';
  return { dark, bg:dark?C.dkBg:C.ltBg, card:dark?C.dkCard:C.ltCard, bdr:dark?C.dkBorder:C.ltBorder, txt:dark?C.dkText:C.ltText, sub:dark?C.dkSub:C.ltSub, inp:dark?C.dkInput:C.ltInput, inpB:dark?C.dkInputBdr:C.ltInputBdr };
}

// ─── Types ──────────────────────────────────────────────────────────────────
type Coords = { lat: number; lng: number };
type Suggestion = { description: string; place_id: string; mainText: string; secondaryText: string };

function newToken() { return 'tok_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); }
function pad2(n: number) { return String(n).padStart(2,'0'); }
function toYMD(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function addMonths(d: Date, n: number) { const nd=new Date(d); nd.setMonth(nd.getMonth()+n); return nd; }
function getMonthMatrix(d: Date) {
  const firstDay=new Date(d.getFullYear(),d.getMonth(),1).getDay();
  const days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  const weeks:Array<Array<Date|null>>=[];let cur=1-firstDay;
  for(let w=0;w<6;w++){const row:Array<Date|null>=[];for(let i=0;i<7;i++){row.push(cur<1||cur>days?null:new Date(d.getFullYear(),d.getMonth(),cur));cur++;}weeks.push(row);}
  return weeks;
}

// ─── Address Autocomplete ────────────────────────────────────────────────────
function AddressAutocomplete({ label, placeholder, value, onChangeText, onSelected, apiKey, country='us', zIndex=50, theme, dotColor }: {
  label:string; placeholder:string; value:string;
  onChangeText:(t:string)=>void;
  onSelected:(p:{address:string;coords:Coords})=>void;
  apiKey:string; country?:string; zIndex?:number;
  theme:ReturnType<typeof useT>; dotColor?:string;
}) {
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [items,setItems]=useState<Suggestion[]>([]);
  const [timer,setTimer]=useState<any>(null);
  const justSelected=useRef(false);
  const token=useMemo(()=>newToken(),[]);

  const fetchAuto=async(q:string)=>{
    if(!q||q.trim().length<2){setItems([]);return;}
    try{setLoading(true);const res=await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&key=${apiKey}&components=country:${country}&sessiontoken=${token}`);const json=await res.json();setItems((json?.predictions||[]).map((p:any)=>({description:p.description,place_id:p.place_id,mainText:p.structured_formatting?.main_text||p.description,secondaryText:p.structured_formatting?.secondary_text||''})));}
    catch{setItems([]);}finally{setLoading(false);}
  };

  const fetchDetails=async(place_id:string)=>{
    const res=await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=name,formatted_address,geometry&key=${apiKey}&sessiontoken=${token}`);const json=await res.json();
    const name=json?.result?.name||'';const fmt=json?.result?.formatted_address||value;const addr=(name&&fmt&&!fmt.startsWith(name))?`${name}, ${fmt}`:fmt;const loc=json?.result?.geometry?.location;
    onSelected({address:addr,coords:loc&&typeof loc.lat==='number'?{lat:loc.lat,lng:loc.lng}:{lat:0,lng:0}});
  };

  return (
    <View style={{zIndex}}>
      <View style={[s.acRow,{backgroundColor:theme.inp,borderColor:value?C.orangeBorder:theme.inpB}]}>
        <BlurView intensity={theme.dark?16:35} tint={theme.dark?'dark':'light'} style={StyleSheet.absoluteFillObject}/>
        <View style={[s.acDot,{backgroundColor:dotColor||C.orange}]}/>
        <View style={{flex:1}}>
          <Text style={[s.acLabel,{color:value?C.orange:theme.sub}]}>{label}</Text>
          <TextInput style={[s.acInput,{color:theme.txt}]} placeholder={placeholder} placeholderTextColor={theme.dark?'#344D60':'#A8B8C8'} value={value}
            onFocus={()=>setOpen(true)}
            onChangeText={t=>{if(justSelected.current){justSelected.current=false;return;}onChangeText(t);setOpen(true);if(timer)clearTimeout(timer);setTimer(setTimeout(()=>fetchAuto(t),220));}}/>
        </View>
        {value?<TouchableOpacity onPress={()=>{onChangeText('');setItems([]);}} style={{padding:10}}><Ionicons name="close-circle" size={17} color={theme.sub}/></TouchableOpacity>:null}
      </View>
      {open&&(items.length>0||loading)&&(
        <View style={[s.acPanel,{backgroundColor:theme.dark?'#0F1923':'#FFF',borderColor:theme.inpB}]}>
          {loading
            ?<View style={s.acPanelEmpty}><ActivityIndicator size="small" color={C.orange}/></View>
            :items.slice(0,8).map((it,idx)=>(
              <TouchableOpacity key={`${it.place_id}-${idx}`} style={[s.acItem,{borderBottomColor:theme.inpB}]} onPress={async()=>{setOpen(false);setItems([]);justSelected.current=true;await fetchDetails(it.place_id);setTimeout(()=>Keyboard.dismiss(),50);}}>
                <Ionicons name="location-outline" size={13} color={C.orange} style={{marginTop:2,flexShrink:0}}/>
                <View style={{flex:1,marginLeft:8}}>
                  <Text style={[s.acMain,{color:theme.txt}]} numberOfLines={1}>{it.mainText}</Text>
                  {it.secondaryText?<Text style={[s.acSub,{color:theme.sub}]} numberOfLines={1}>{it.secondaryText}</Text>:null}
                </View>
              </TouchableOpacity>
            ))
          }
        </View>
      )}
    </View>
  );
}

// ─── Calendar Modal ──────────────────────────────────────────────────────────
function CalendarModal({visible,month,selectedDate,primaryColor,secondaryColor,onClose,onSelect}:{
  visible:boolean;month:Date;selectedDate?:string;primaryColor:string;secondaryColor:string;
  onClose:()=>void;onSelect:(ds:string)=>void;
}) {
  const [m,setM]=useState(month);useEffect(()=>setM(month),[month]);
  const weeks=useMemo(()=>getMonthMatrix(m),[m]);const todayStr=toYMD(new Date());
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalBg}>
        <View style={s.calCard}>
          <View style={s.calHdr}>
            <TouchableOpacity onPress={()=>setM(addMonths(m,-1))} style={s.calNav}><Ionicons name="chevron-back" size={20} color={primaryColor}/></TouchableOpacity>
            <Text style={[s.calTitle,{color:secondaryColor}]}>{m.toLocaleString(undefined,{month:'long',year:'numeric'})}</Text>
            <TouchableOpacity onPress={()=>setM(addMonths(m,1))} style={s.calNav}><Ionicons name="chevron-forward" size={20} color={primaryColor}/></TouchableOpacity>
          </View>
          <View style={s.calWeekRow}>{['S','M','T','W','T','F','S'].map((w,i)=><Text key={i} style={s.calWeekDay}>{w}</Text>)}</View>
          {weeks.map((row,ri)=>(
            <View key={ri} style={s.calDayRow}>
              {row.map((d,ci)=>{const ds=d?toYMD(d):'';const sel=!!d&&selectedDate===ds;const today=!!d&&todayStr===ds;
                return(<TouchableOpacity key={ci} disabled={!d} onPress={()=>{if(d){onSelect(toYMD(d));onClose();}}} style={[s.calDay,!d&&{opacity:0.12},sel&&{backgroundColor:primaryColor},!sel&&today&&{borderWidth:1.5,borderColor:primaryColor}]}><Text style={[s.calDayTxt,sel&&{color:'#FFF',fontWeight:'800'}]}>{d?String(d.getDate()):''}</Text></TouchableOpacity>);
              })}
            </View>
          ))}
          <TouchableOpacity onPress={onClose} style={s.calClose}><Text style={[s.calCloseTxt,{color:primaryColor}]}>Close</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Time Modal ──────────────────────────────────────────────────────────────
function TimeModal({visible,initialTime,primaryColor,secondaryColor,onClose,onSelect}:{
  visible:boolean;initialTime?:string;primaryColor:string;secondaryColor:string;
  onClose:()=>void;onSelect:(ts:string)=>void;
}) {
  const parseTo12h=(s?:string):{h12:number;m:number;ampm:'AM'|'PM'}=>{
    const now=new Date();const r30=(n:number)=>Math.round(n/30)*30;
    if(!s){let h=now.getHours();let m=r30(now.getMinutes());if(m>=60){m=0;h=(h+1)%24;}const ap:any=h>=12?'PM':'AM';let h12=h%12;if(h12===0)h12=12;return{h12,m,ampm:ap};}
    let str=s.trim().toLowerCase();const hasAM=/am?$/.test(str);const hasPM=/pm?$/.test(str);
    str=str.replace(/\s/g,'').replace(/(am|pm|a|p)$/,'');let h=0,m=0;
    if(str.includes(':')||str.includes('.')){const p=str.split(/[:.]/);h=parseInt(p[0]||'0',10)||0;m=parseInt(p[1]||'0',10)||0;}
    else if(str.length<=2){h=parseInt(str||'0',10)||0;m=0;}
    else{h=parseInt(str.slice(0,-2)||'0',10)||0;m=parseInt(str.slice(-2)||'0',10)||0;}
    if(hasPM&&h<12)h+=12;if(hasAM&&h===12)h=0;
    h=Math.max(0,Math.min(23,h));m=Math.max(0,Math.min(59,m));m=r30(m);if(m>=60){m=0;h=(h+1)%24;}
    const ap:any=h>=12?'PM':'AM';let h12=h%12;if(h12===0)h12=12;return{h12,m,ampm:ap};
  };
  const init=parseTo12h(initialTime);
  const [hour,setHour]=useState(init.h12);const [minute,setMinute]=useState(init.m);const [ampm,setAmpm]=useState<'AM'|'PM'>(init.ampm);
  useEffect(()=>{const p=parseTo12h(initialTime);setHour(p.h12);setMinute(p.m);setAmpm(p.ampm);},[initialTime,visible]);
  const incH=()=>setHour(h=>(h%12)+1);const decH=()=>setHour(h=>h===1?12:h-1);
  const incM=()=>setMinute(m=>{const nm=(m+30)%60;if(nm<m)setHour(h=>(h%12)+1);return nm;});
  const decM=()=>setMinute(m=>{const nm=(m+30)%60;if(m===0)setHour(h=>h===1?12:h-1);return nm;});
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalBg}>
        <View style={s.timeCard}>
          <Text style={[s.calTitle,{color:secondaryColor,marginBottom:16,textAlign:'center'}]}>Select Time</Text>
          <View style={s.clockRow}>
            <View style={s.stepCol}>
              <TouchableOpacity onPress={incH} style={[s.stepBtn,{borderColor:primaryColor}]}><Text style={[s.stepTxt,{color:primaryColor}]}>+</Text></TouchableOpacity>
              <TouchableOpacity onPress={decH} style={[s.stepBtn,{borderColor:primaryColor}]}><Text style={[s.stepTxt,{color:primaryColor}]}>-</Text></TouchableOpacity>
            </View>
            <View style={s.clockFace}>
              <Text style={[s.clockTxt,{color:secondaryColor}]}>{hour}</Text>
              <Text style={[s.clockTxt,{color:secondaryColor}]}>:</Text>
              <Text style={[s.clockTxt,{color:secondaryColor}]}>{pad2(minute)}</Text>
              <TouchableOpacity onPress={()=>setAmpm(a=>a==='AM'?'PM':'AM')} style={[s.ampmPill,{borderColor:primaryColor}]}><Text style={[s.ampmPillTxt,{color:primaryColor}]}>{ampm}</Text></TouchableOpacity>
            </View>
            <View style={s.stepCol}>
              <TouchableOpacity onPress={incM} style={[s.stepBtn,{borderColor:primaryColor}]}><Text style={[s.stepTxt,{color:primaryColor}]}>+</Text></TouchableOpacity>
              <TouchableOpacity onPress={decM} style={[s.stepBtn,{borderColor:primaryColor}]}><Text style={[s.stepTxt,{color:primaryColor}]}>-</Text></TouchableOpacity>
            </View>
          </View>
          <View style={s.ampmRow}>
            {(['AM','PM'] as const).map(x=>(
              <TouchableOpacity key={x} onPress={()=>setAmpm(x)} style={[s.ampmChip,ampm===x&&{backgroundColor:primaryColor}]}><Text style={[s.ampmChipTxt,ampm===x&&{color:'#FFF'}]}>{x}</Text></TouchableOpacity>
            ))}
          </View>
          <View style={s.timeFooter}>
            <TouchableOpacity onPress={onClose} style={s.tCancel}><Text style={[s.tCancelTxt,{color:secondaryColor}]}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={()=>{onSelect(`${hour}:${pad2(minute)} ${ampm}`);onClose();}} style={[s.tConfirm,{backgroundColor:primaryColor}]}><Text style={s.tConfirmTxt}>Set Time</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Glass Card ──────────────────────────────────────────────────────────────
function GlassCard({theme,children,style}:{theme:ReturnType<typeof useT>;children:React.ReactNode;style?:any}) {
  return (
    <View style={[s.card,{backgroundColor:theme.card,borderColor:theme.bdr},style]}>
      <BlurView intensity={theme.dark?22:55} tint={theme.dark?'dark':'light'} style={StyleSheet.absoluteFillObject}/>
      <View style={{zIndex:1}}>{children}</View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function BookScreen() {
  const theme=useT(); const dk=theme.dark;

  // ── State (ALL UNCHANGED) ──
  const [date,setDate]=useState('');
  const [time,setTime]=useState('');
  const [calendarOpen,setCalendarOpen]=useState(false);
  const [calendarMonth,setCalendarMonth]=useState<Date>(()=>{if(!date)return new Date();const p=date.split('-');if(p.length===3){const dt=new Date(+p[0],+p[1]-1,+p[2]);if(!isNaN(dt.getTime()))return dt;}return new Date();});
  const [timeOpen,setTimeOpen]=useState(false);
  const [pickupLocation,setPickupLocation]=useState('');
  const [dropoffLocation,setDropoffLocation]=useState('');
  const [contribution,setContribution]=useState('');
  const [notes,setNotes]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [locLoading,setLocLoading]=useState(false);
  const [pickupCoords,setPickupCoords]=useState<Coords|null>(null);
  const [dropoffCoords,setDropoffCoords]=useState<Coords|null>(null);
  const [distanceText,setDistanceText]=useState('--');
  const [durationText,setDurationText]=useState('--');
  const [calcLoading,setCalcLoading]=useState(false);
  const [distanceMiles,setDistanceMiles]=useState<number|null>(null);
  const [durationMinutes,setDurationMinutes]=useState<number|null>(null);
  const [minContribution,setMinContribution]=useState<number|null>(null);
  const [paymentModalVisible,setPaymentModalVisible]=useState(false);
  const [pendingRideData,setPendingRideData]=useState<any>(null);
  const [tempRideId,setTempRideId]=useState(()=>`temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const [scheduleMode,setScheduleMode]=useState<'now'|'schedule'>('now');

  // ── Helpers (UNCHANGED) ──
  const to24h=(t:string)=>{const m=/^\s*(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)\s*$/i.exec(t);if(m){let h=parseInt(m[1],10);const mm=Math.max(0,Math.min(59,parseInt(m[2]||'0',10)));const ap=m[3].toLowerCase();if(ap==='pm'&&h<12)h+=12;if(ap==='am'&&h===12)h=0;return`${pad2(h)}:${pad2(mm)}`;}const m2=/^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(t);if(m2){const h=Math.max(0,Math.min(23,parseInt(m2[1],10)));const mm=Math.max(0,Math.min(59,parseInt(m2[2],10)));return`${pad2(h)}:${pad2(mm)}`;}return t;};
  const toRequestedDate=(d?:string,t?:string):Date|null=>{try{if(!d&&!t)return null;if(d&&t){const t24=/am|pm/i.test(t)?to24h(t):t;const dt=new Date(`${d}T${t24}`);return isNaN(dt.getTime())?null:dt;}if(d){const dt=new Date(d);return isNaN(dt.getTime())?null:dt;}if(t){const dt=new Date(t);return isNaN(dt.getTime())?null:dt;}return null;}catch{return null;}};

  // ── handleSubmit (UNCHANGED) ──
  const handleSubmit=async()=>{
    try{
      if(!checkCanRequestRide())return;
      const user=firebaseAuth.currentUser;if(!user){Alert.alert('Sign in required','Please sign in to book a ride.');router.push('/(auth)/sign-in');return;}
      if(!pickupLocation.trim()||!dropoffLocation.trim()){Alert.alert('Missing info','Please enter both pickup and dropoff locations.');return;}
      const priceNum=(()=>{const n=Number(String(contribution).replace(/[^0-9.\-]/g,''));return isNaN(n)?null:n;})();
      if(minContribution!=null&&(priceNum==null||priceNum<minContribution)){Alert.alert('Contribution too low',`Minimum: $${minContribution.toFixed(2)}`);return;}
      if(!priceNum||priceNum<=0){Alert.alert('Invalid price','Please enter a valid price for the ride.');return;}
      const requestedTime=toRequestedDate(date||undefined,time||undefined);
      const payload:any={userId:user.uid,riderId:user.uid,userEmail:user.email||null,riderEmail:user.email||null,pickup:pickupLocation||null,dropoff:dropoffLocation||null,date:date||null,time:time||null,distance:distanceText||null,requestedTime:requestedTime||null,passengers:1,estimatedFare:priceNum,contributionAmount:priceNum,notes:notes||null,status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
      Object.keys(payload).forEach(k=>{if(payload[k]===undefined)payload[k]=null;});
      setPendingRideData(payload);setPaymentModalVisible(true);
    }catch(err:any){Alert.alert('Error',err?.message||'Please check your inputs');}
  };

  // ── handlePaymentSuccess (UNCHANGED) ──
  const handlePaymentSuccess=async(paymentIntentId:string)=>{
    try{
      if(!pendingRideData){Alert.alert('Error','No ride data found');return;}
      const user=firebaseAuth.currentUser;if(!user){Alert.alert('Error','User not authenticated');return;}
      const userName=user.displayName||pendingRideData.riderName||'Rider';
      const rideDataWithPayment={...pendingRideData,riderName:userName,paymentIntentId,paymentStatus:'authorized'};
      const apiUrl=getApiBaseUrl();let response;
      try{response=await fetch(`${apiUrl}/api/ride-requests`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rideDataWithPayment)});}
      catch(networkError:any){throw new Error('Cannot connect to server. Using fallback method.');}
      const contentType=response.headers.get('content-type');
      if(!contentType||!contentType.includes('application/json')){await response.text();throw new Error(`Server error (${response.status}). Using fallback method.`);}
      const result=await response.json();if(!response.ok)throw new Error(result.message||result.error||'Failed to create ride request');
      void logActivity({type:'ride_request_created',entityType:'rideRequest',entityId:result.requestId,metadata:{contribution:pendingRideData.contributionAmount??null,requestedTime:pendingRideData.requestedTime?new Date(pendingRideData.requestedTime).toISOString():null,paymentIntentId}});
      setDate('');setTime('');setPickupLocation('');setDropoffLocation('');setContribution('');setNotes('');setPendingRideData(null);setPaymentModalVisible(false);setTempRideId(`temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      Alert.alert('Request Posted!','Your ride request is live. Drivers will be able to find you.');router.push('/rider' as any);
    }catch(e:any){
      try{
        const user=firebaseAuth.currentUser;if(!user)throw e;
        const rideDataWithPayment={...pendingRideData,riderName:user.displayName||'Rider',paymentIntentId,paymentStatus:'authorized'};
        const docRef=await addDoc(collection(firestore,'rideRequests'),rideDataWithPayment);
        try{const pu=(pendingRideData.pickup||'').trim().toLowerCase().replace(/\s+/g,' ');const dr=(pendingRideData.dropoff||'').trim().toLowerCase().replace(/\s+/g,' ');if(pu&&dr){const rq=query(collection(firestore,'preferredRoutes'),where('userId','==',user.uid),where('origin','==',pu),where('destination','==',dr));const rs=await getDocs(rq);if(rs.empty)await addDoc(collection(firestore,'preferredRoutes'),{userId:user.uid,userType:'rider',origin:pu,destination:dr,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});}}catch{}
        void logActivity({type:'ride_request_created',entityType:'rideRequest',entityId:docRef.id,metadata:{contribution:pendingRideData.contributionAmount??null,requestedTime:pendingRideData.requestedTime?new Date(pendingRideData.requestedTime).toISOString():null,paymentIntentId}});
        setDate('');setTime('');setPickupLocation('');setDropoffLocation('');setContribution('');setNotes('');setPendingRideData(null);setTempRideId(`temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);setPaymentModalVisible(false);
        Alert.alert('Request Posted!','Your ride request is live. Drivers will be able to find you.');router.push('/rider' as any);
      }catch{Alert.alert('Submit failed','Could not submit your request. Please try again.');}
    }
  };

  const swapLocations=()=>{const p=pickupLocation,pc=pickupCoords;setPickupLocation(dropoffLocation);setDropoffLocation(p);setPickupCoords(dropoffCoords);setDropoffCoords(pc||null);};
  const useCurrentLocation=async()=>{
    try{setLocLoading(true);const{status}=await Location.requestForegroundPermissionsAsync();if(status!=='granted'){Alert.alert('Permission required','Location permission is needed.');return;}
    const pos=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});const results=await Location.reverseGeocodeAsync({latitude:pos.coords.latitude,longitude:pos.coords.longitude});
    const r=results?.[0];const address=r?[r.name,r.street,r.city,r.region].filter(Boolean).join(', '):'Current location';setPickupLocation(address);setPickupCoords({lat:pos.coords.latitude,lng:pos.coords.longitude});}
    catch{Alert.alert('Location error','Could not get your location.');}finally{setLocLoading(false);}
  };

  // ── Distance calc (UNCHANGED) ──
  useEffect(()=>{
    let timer:any;
    const fetch_=async()=>{
      if(!pickupCoords||!dropoffCoords)return;
      try{setCalcLoading(true);const url=`https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins=${encodeURIComponent(`${pickupCoords.lat},${pickupCoords.lng}`)}&destinations=${encodeURIComponent(`${dropoffCoords.lat},${dropoffCoords.lng}`)}&key=${GOOGLE_MAPS_API_KEY}`;
        const res=await fetch(url);const json=await res.json();const el=json?.rows?.[0]?.elements?.[0];
        const dist=el?.distance?.text??null;const dur=el?.duration?.text??null;
        if(dist&&dur){setDistanceText(dist);setDurationText(dur);const mi=el?.distance?.value!=null?el.distance.value/1609.34:null;const mn=el?.duration?.value!=null?el.duration.value/60:null;setDistanceMiles(mi);setDurationMinutes(mn);if(mi!=null){const est=computeBaseFare(mi,1);setMinContribution(Number(est.toFixed(2)));}else setMinContribution(null);}
        else{setDistanceText('--');setDurationText('--');setDistanceMiles(null);setDurationMinutes(null);setMinContribution(null);}
      }catch{setDistanceText('--');setDurationText('--');}finally{setCalcLoading(false);}
    };
    timer=setTimeout(fetch_,250);return()=>clearTimeout(timer);
  },[pickupCoords,dropoffCoords]);

  const contribNum=Number(contribution);
  const contribTooLow=minContribution!=null&&contribNum>0&&contribNum<minContribution;
  const isFormValid=!!(pickupLocation.trim()&&dropoffLocation.trim()&&(minContribution==null||(contribNum&&contribNum>=minContribution)));

  return (
    <View style={s.root}>
      <StatusBar barStyle={dk?'light-content':'dark-content'}/>
      <LinearGradient colors={dk?[C.dkBg,C.dkBg2,C.dkBg3]:[C.ltBg,'#F2F5FA','#FFF']} style={StyleSheet.absoluteFillObject}/>

      <SafeAreaView style={s.safe} edges={['top']}>
        {/* ── Header ── */}
        <View style={s.hdr}>
          <TouchableOpacity onPress={()=>router.back()} style={[s.hdrBack,{backgroundColor:dk?'rgba(255,255,255,0.09)':'rgba(255,255,255,0.85)'}]}>
            <Ionicons name="arrow-back" size={20} color={theme.txt}/>
          </TouchableOpacity>
          <View style={{flex:1,marginLeft:12}}>
            <Text style={[s.hdrTitle,{color:theme.txt}]}>Book a Ride</Text>
            <Text style={[s.hdrSub,{color:theme.sub}]}>Where would you like to go?</Text>
          </View>
          <TouchableOpacity onPress={()=>router.push('/settings/ride-history')} style={[s.hdrRides,{backgroundColor:dk?'rgba(255,255,255,0.09)':'rgba(255,255,255,0.85)',borderColor:theme.bdr}]}>
            <Ionicons name="time-outline" size={15} color={theme.txt}/>
            <Text style={[s.hdrRidesTxt,{color:theme.txt}]}>Your Rides</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} keyboardVerticalOffset={Platform.OS==='ios'?24:0} style={{flex:1}}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <FlatList
              style={{flex:1}} data={[0]} keyExtractor={()=>'main'} renderItem={()=>null}
              keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}
              contentContainerStyle={s.scroll}
              ListHeaderComponent={(
                <View>

                  {/* ── Route Card ── */}
                  <GlassCard theme={theme}>
                    <View style={s.cardHdr}>
                      <View style={[s.cardIcon,{backgroundColor:C.orangeGlow}]}><Ionicons name="navigate-outline" size={16} color={C.orange}/></View>
                      <Text style={[s.cardTitle,{color:theme.txt}]}>Your Route</Text>
                    </View>
                    <View style={s.routeWrap}>
                      <View style={s.routeConnector}>
                        <View style={s.dotOrange}/>
                        <View style={[s.connLine,{backgroundColor:dk?'rgba(244,98,31,0.28)':'rgba(244,98,31,0.18)'}]}/>
                        <View style={s.dotGray}/>
                      </View>
                      <View style={{flex:1,gap:8}}>
                        <View style={{zIndex:60}}>
                          <AddressAutocomplete label="Pickup" placeholder="Where are you?" value={pickupLocation} apiKey={GOOGLE_MAPS_API_KEY}
                            onChangeText={t=>{setPickupLocation(t);setPickupCoords(null);}}
                            onSelected={({address,coords})=>{setPickupLocation(address);setPickupCoords(coords);}}
                            zIndex={60} theme={theme} dotColor={C.orange}/>
                        </View>
                        <View style={{zIndex:50}}>
                          <AddressAutocomplete label="Dropoff" placeholder="Where to?" value={dropoffLocation} apiKey={GOOGLE_MAPS_API_KEY}
                            onChangeText={t=>{setDropoffLocation(t);setDropoffCoords(null);}}
                            onSelected={({address,coords})=>{setDropoffLocation(address);setDropoffCoords(coords);}}
                            zIndex={50} theme={theme} dotColor="#94A3B8"/>
                        </View>
                      </View>
                    </View>
                    <View style={s.qRow}>
                      <TouchableOpacity style={[s.qBtn,{backgroundColor:dk?'rgba(244,98,31,0.10)':'rgba(244,98,31,0.07)',borderColor:C.orangeBorder}]} onPress={useCurrentLocation} disabled={locLoading}>
                        {locLoading?<ActivityIndicator size="small" color={C.orange}/>:<Ionicons name="locate" size={15} color={C.orange}/>}
                        <Text style={[s.qBtnTxt,{color:C.orange}]}>{locLoading?'Locating…':'My Location'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.qBtn,{backgroundColor:theme.inp,borderColor:theme.inpB}]} onPress={swapLocations}>
                        <Ionicons name="swap-vertical" size={15} color={theme.sub}/>
                        <Text style={[s.qBtnTxt,{color:theme.sub}]}>Swap</Text>
                      </TouchableOpacity>
                    </View>
                    {!!(pickupCoords&&dropoffCoords)&&(
                      <View style={[s.strip,{backgroundColor:dk?'rgba(244,98,31,0.07)':'rgba(244,98,31,0.05)',borderColor:C.orangeBorder}]}>
                        <View style={s.stripItem}><Ionicons name="map-outline" size={14} color={C.orange}/><Text style={[s.stripLabel,{color:theme.sub}]}>Distance</Text><Text style={[s.stripVal,{color:theme.txt}]}>{calcLoading?'…':distanceText}</Text></View>
                        <View style={[s.stripDiv,{backgroundColor:C.orangeBorder}]}/>
                        <View style={s.stripItem}><Ionicons name="time-outline" size={14} color={C.orange}/><Text style={[s.stripLabel,{color:theme.sub}]}>Duration</Text><Text style={[s.stripVal,{color:theme.txt}]}>{calcLoading?'…':durationText}</Text></View>
                      </View>
                    )}
                  </GlassCard>

                  {/* ── Schedule Card ── */}
                  <GlassCard theme={theme}>
                    <View style={s.cardHdr}>
                      <View style={[s.cardIcon,{backgroundColor:dk?'rgba(99,102,241,0.15)':'rgba(99,102,241,0.10)'}]}><Ionicons name="calendar-outline" size={16} color="#6366F1"/></View>
                      <Text style={[s.cardTitle,{color:theme.txt}]}>When do you want to go?</Text>
                    </View>
                    {/* Leave Now / Schedule Ride toggle (from inspo) */}
                    <View style={[s.schToggle,{backgroundColor:dk?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.04)'}]}>
                      <TouchableOpacity style={[s.schBtn,scheduleMode==='now'&&{backgroundColor:C.orange}]} onPress={()=>setScheduleMode('now')} activeOpacity={0.85}>
                        <Ionicons name="flash" size={17} color={scheduleMode==='now'?'#FFF':theme.sub}/>
                        <View><Text style={[s.schBtnTxt,{color:scheduleMode==='now'?'#FFF':theme.txt}]}>Leave Now</Text><Text style={[s.schBtnSub,{color:scheduleMode==='now'?'rgba(255,255,255,0.75)':theme.sub}]}>Find a ride near you</Text></View>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.schBtn,scheduleMode==='schedule'&&{backgroundColor:C.orange}]} onPress={()=>setScheduleMode('schedule')} activeOpacity={0.85}>
                        <Ionicons name="calendar" size={17} color={scheduleMode==='schedule'?'#FFF':theme.sub}/>
                        <View><Text style={[s.schBtnTxt,{color:scheduleMode==='schedule'?'#FFF':theme.txt}]}>Schedule Ride</Text><Text style={[s.schBtnSub,{color:scheduleMode==='schedule'?'rgba(255,255,255,0.75)':theme.sub}]}>Pick date & time</Text></View>
                      </TouchableOpacity>
                    </View>
                    {scheduleMode==='schedule'&&(
                      <View style={[s.dtRow,{marginTop:12}]}>
                        <TouchableOpacity style={[s.dtBtn,{backgroundColor:theme.inp,borderColor:date?C.orangeBorder:theme.inpB}]} onPress={()=>{Keyboard.dismiss();setCalendarOpen(true);}} activeOpacity={0.8}>
                          <BlurView intensity={dk?15:30} tint={dk?'dark':'light'} style={StyleSheet.absoluteFillObject}/>
                          <View style={[s.dtIcon,{backgroundColor:date?C.orangeGlow:(dk?'rgba(99,102,241,0.12)':'rgba(99,102,241,0.08)')}]}><Ionicons name="calendar-outline" size={17} color={date?C.orange:'#6366F1'}/></View>
                          <View><Text style={[s.dtLabel,{color:theme.sub}]}>Date</Text><Text style={[s.dtVal,{color:date?theme.txt:theme.sub}]}>{date||'Select date'}</Text></View>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.dtBtn,{backgroundColor:theme.inp,borderColor:time?C.orangeBorder:theme.inpB}]} onPress={()=>{Keyboard.dismiss();setTimeOpen(true);}} activeOpacity={0.8}>
                          <BlurView intensity={dk?15:30} tint={dk?'dark':'light'} style={StyleSheet.absoluteFillObject}/>
                          <View style={[s.dtIcon,{backgroundColor:time?C.orangeGlow:(dk?'rgba(244,98,31,0.10)':'rgba(244,98,31,0.06)')}]}><Ionicons name="time-outline" size={17} color={C.orange}/></View>
                          <View><Text style={[s.dtLabel,{color:theme.sub}]}>Time</Text><Text style={[s.dtVal,{color:time?theme.txt:theme.sub}]}>{time||'Select time'}</Text></View>
                        </TouchableOpacity>
                      </View>
                    )}
                    <CalendarModal visible={calendarOpen} month={calendarMonth} selectedDate={date} primaryColor={C.orange} secondaryColor={dk?C.dkText:C.ltText} onClose={()=>setCalendarOpen(false)} onSelect={ds=>{setDate(ds);setCalendarOpen(false);setCalendarMonth(new Date(ds));}}/>
                    <TimeModal visible={timeOpen} initialTime={time} primaryColor={C.orange} secondaryColor={dk?C.dkText:C.ltText} onClose={()=>setTimeOpen(false)} onSelect={ts=>{setTime(ts);setTimeOpen(false);}}/>
                  </GlassCard>

                  {/* ── Payment Card ── */}
                  <GlassCard theme={theme}>
                    <View style={s.cardHdr}>
                      <View style={[s.cardIcon,{backgroundColor:dk?'rgba(16,185,129,0.15)':'rgba(16,185,129,0.10)'}]}><Ionicons name="wallet-outline" size={16} color={C.green}/></View>
                      <Text style={[s.cardTitle,{color:theme.txt}]}>Your Contribution</Text>
                    </View>
                    <View style={[s.priceRow,{backgroundColor:theme.inp,borderColor:contribTooLow?C.red:contribNum>0?C.orangeBorder:theme.inpB}]}>
                      <BlurView intensity={dk?15:30} tint={dk?'dark':'light'} style={StyleSheet.absoluteFillObject}/>
                      <View style={[s.pricePrefix,{backgroundColor:dk?'rgba(16,185,129,0.14)':'rgba(16,185,129,0.09)'}]}><Text style={[s.pricePrefixTxt,{color:C.green}]}>$</Text></View>
                      <TextInput style={[s.priceInput,{color:theme.txt}]} placeholder="0.00" placeholderTextColor={dk?'#344D60':'#A8B8C8'} value={contribution} onChangeText={setContribution} keyboardType="numeric"/>
                      {contribNum>0&&!contribTooLow&&<Ionicons name="checkmark-circle" size={20} color={C.green} style={{marginRight:14}}/>}
                    </View>
                    <Text style={[s.priceHint,{color:contribTooLow?C.red:theme.sub}]}>
                      {minContribution==null?'Enter pickup & dropoff to see minimum fare':`Minimum fare: $${minContribution.toFixed(2)}${contribTooLow?'  ·  Amount too low':contribNum>=minContribution?'  ✓  Good to go!':''}`}
                    </Text>
                  </GlassCard>

                  {/* ── Notes Card ── */}
                  <GlassCard theme={theme}>
                    <View style={s.cardHdr}>
                      <View style={[s.cardIcon,{backgroundColor:dk?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.04)'}]}><Ionicons name="document-text-outline" size={16} color={theme.sub}/></View>
                      <Text style={[s.cardTitle,{color:theme.txt}]}>Notes</Text>
                      <View style={[s.optBadge,{backgroundColor:dk?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.05)'}]}><Text style={[s.optBadgeTxt,{color:theme.sub}]}>Optional</Text></View>
                    </View>
                    <TextInput style={[s.notesInput,{backgroundColor:theme.inp,borderColor:theme.inpB,color:theme.txt}]} placeholder="Special instructions, luggage, accessibility needs…" placeholderTextColor={dk?'#344D60':'#A8B8C8'} value={notes} onChangeText={setNotes} multiline numberOfLines={3} textAlignVertical="top"/>
                  </GlassCard>

                  {/* ── Book Ride Button (matches reference) ── */}
                  <TouchableOpacity onPress={handleSubmit} disabled={submitting||!isFormValid} activeOpacity={0.87}>
                    <LinearGradient
                      colors={isFormValid&&!submitting?[C.orange,C.orangeLight]:(dk?['#1A2838','#1A2838']:['#D0D8E4','#D0D8E4'])}
                      start={{x:0,y:0}} end={{x:1,y:0}} style={s.bookBtn}
                    >
                      {submitting&&<ActivityIndicator size="small" color="#FFF" style={{marginRight:10}}/>}
                      <Text style={[s.bookBtnTxt,{color:isFormValid&&!submitting?'#FFF':(dk?'#3A5068':'#8FA0B0')}]}>{submitting?'Booking…':'Book Ride'}</Text>
                      {isFormValid&&contribNum>0&&!submitting&&(
                        <View style={s.bookBtnBadge}><Text style={s.bookBtnBadgeTxt}>${contribNum.toFixed(2)}</Text></View>
                      )}
                      {isFormValid&&!submitting&&(
                        <View style={s.bookBtnArrow}><Ionicons name="arrow-forward" size={18} color={C.orange}/></View>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>

                  {/* Security note */}
                  <View style={s.secRow}>
                    <Ionicons name="lock-closed-outline" size={13} color={theme.sub}/>
                    <Text style={[s.secTxt,{color:theme.sub}]}>Secure booking  ·  You can cancel anytime</Text>
                  </View>

                  <View style={{height:40}}/>
                </View>
              )}
            />
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Payment Modal */}
      {pendingRideData&&paymentModalVisible&&(
        <PaymentModal visible={paymentModalVisible} onClose={()=>{setPaymentModalVisible(false);setPendingRideData(null);setSubmitting(false);}} rideId={tempRideId} driverId={firebaseAuth.currentUser?.uid||null} baseFare={pendingRideData.contributionAmount||0} onPaymentSuccess={handlePaymentSuccess}/>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s=StyleSheet.create({
  root:{flex:1}, safe:{flex:1}, scroll:{paddingHorizontal:16,paddingTop:6,paddingBottom:40},

  // Header
  hdr:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingTop:6,paddingBottom:10},
  hdrBack:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center'},
  hdrTitle:{fontSize:22,fontWeight:'800',letterSpacing:-0.5},
  hdrSub:{fontSize:13,fontWeight:'400',marginTop:1},
  hdrRides:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:12,paddingVertical:8,borderRadius:50,borderWidth:1},
  hdrRidesTxt:{fontSize:13,fontWeight:'600'},

  // Card (glassmorphic)
  card:{borderRadius:22,borderWidth:1.5,overflow:'hidden',marginBottom:14,shadowColor:'#000',shadowOffset:{width:0,height:6},shadowOpacity:0.09,shadowRadius:16,elevation:6,padding:18},
  cardHdr:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:16},
  cardIcon:{width:34,height:34,borderRadius:10,alignItems:'center',justifyContent:'center'},
  cardTitle:{fontSize:16,fontWeight:'700',flex:1,letterSpacing:-0.3},

  // Route connector
  routeWrap:{flexDirection:'row',gap:12},
  routeConnector:{width:18,alignItems:'center',paddingTop:28,paddingBottom:28},
  dotOrange:{width:12,height:12,borderRadius:6,backgroundColor:C.orange},
  dotGray:{width:12,height:12,borderRadius:6,backgroundColor:'#94A3B8'},
  connLine:{width:2,flex:1,marginVertical:4},

  // Autocomplete
  acRow:{flexDirection:'row',alignItems:'center',borderRadius:14,borderWidth:1.5,overflow:'hidden',minHeight:62,paddingRight:8},
  acDot:{width:8,height:8,borderRadius:4,marginHorizontal:13,flexShrink:0},
  acLabel:{fontSize:10,fontWeight:'700',letterSpacing:0.5,textTransform:'uppercase',marginBottom:1},
  acInput:{fontSize:14,fontWeight:'500',paddingVertical:6},
  acPanel:{position:'absolute',top:66,left:0,right:0,borderRadius:14,borderWidth:1.5,maxHeight:210,overflow:'hidden',elevation:14,shadowColor:'#000',shadowOffset:{width:0,height:5},shadowOpacity:0.18,shadowRadius:14,zIndex:999},
  acPanelEmpty:{padding:16,alignItems:'center'},
  acItem:{flexDirection:'row',alignItems:'flex-start',padding:12,borderBottomWidth:1},
  acMain:{fontSize:14,fontWeight:'600'},
  acSub:{fontSize:12,fontWeight:'400',marginTop:1},

  // Quick buttons
  qRow:{flexDirection:'row',gap:10,marginTop:14},
  qBtn:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingVertical:10,borderRadius:12,borderWidth:1.5},
  qBtnTxt:{fontSize:13,fontWeight:'600'},

  // Distance strip
  strip:{flexDirection:'row',borderRadius:14,borderWidth:1,padding:14,marginTop:14,alignItems:'center'},
  stripItem:{flex:1,alignItems:'center',gap:3},
  stripDiv:{width:1,height:30,marginHorizontal:8},
  stripLabel:{fontSize:10,fontWeight:'700',textTransform:'uppercase',letterSpacing:0.4},
  stripVal:{fontSize:16,fontWeight:'800'},

  // Schedule toggle
  schToggle:{flexDirection:'row',borderRadius:16,overflow:'hidden',gap:4,padding:4},
  schBtn:{flex:1,flexDirection:'row',alignItems:'center',gap:10,padding:13,borderRadius:12},
  schBtnTxt:{fontSize:14,fontWeight:'700'},
  schBtnSub:{fontSize:11,fontWeight:'400',marginTop:1},

  // Date/time
  dtRow:{flexDirection:'row',gap:12},
  dtBtn:{flex:1,flexDirection:'row',alignItems:'center',gap:10,borderRadius:14,borderWidth:1.5,overflow:'hidden',padding:12},
  dtIcon:{width:36,height:36,borderRadius:10,alignItems:'center',justifyContent:'center'},
  dtLabel:{fontSize:10,fontWeight:'700',textTransform:'uppercase',letterSpacing:0.4,marginBottom:2},
  dtVal:{fontSize:14,fontWeight:'600'},

  // Price
  priceRow:{flexDirection:'row',alignItems:'center',borderRadius:14,borderWidth:1.5,overflow:'hidden',height:58},
  pricePrefix:{width:52,height:'100%',alignItems:'center',justifyContent:'center'},
  pricePrefixTxt:{fontSize:22,fontWeight:'800'},
  priceInput:{flex:1,fontSize:22,fontWeight:'700',paddingHorizontal:8},
  priceHint:{fontSize:12,fontWeight:'500',marginTop:8},

  // Notes
  optBadge:{paddingHorizontal:8,paddingVertical:3,borderRadius:8},
  optBadgeTxt:{fontSize:11,fontWeight:'600'},
  notesInput:{borderRadius:14,borderWidth:1.5,padding:14,fontSize:14,minHeight:80},

  // Book button (pill + price badge + arrow — matches reference)
  bookBtn:{borderRadius:999,paddingVertical:18,flexDirection:'row',alignItems:'center',justifyContent:'center',paddingHorizontal:28,shadowColor:C.orange,shadowOffset:{width:0,height:8},shadowOpacity:0.38,shadowRadius:16,elevation:12},
  bookBtnTxt:{fontSize:18,fontWeight:'800',letterSpacing:0.2},
  bookBtnBadge:{marginLeft:12,paddingHorizontal:14,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(255,255,255,0.22)'},
  bookBtnBadgeTxt:{fontSize:16,fontWeight:'800',color:'#FFF'},
  bookBtnArrow:{width:36,height:36,borderRadius:18,backgroundColor:'rgba(255,255,255,0.25)',alignItems:'center',justifyContent:'center',marginLeft:10},

  // Security note
  secRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,marginTop:12},
  secTxt:{fontSize:12,fontWeight:'400'},

  // Modals
  modalBg:{flex:1,backgroundColor:'rgba(8,14,23,0.72)',justifyContent:'center',alignItems:'center',padding:20},
  calCard:{width:'100%',maxWidth:380,backgroundColor:'#FFF',borderRadius:24,padding:20,shadowColor:'#000',shadowOffset:{width:0,height:12},shadowOpacity:0.22,shadowRadius:24,elevation:16},
  calHdr:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:16},
  calTitle:{fontSize:17,fontWeight:'800',color:'#0D1B2A'},
  calNav:{width:36,height:36,borderRadius:18,backgroundColor:'#F1F5F9',alignItems:'center',justifyContent:'center'},
  calWeekRow:{flexDirection:'row',justifyContent:'space-between',marginBottom:8},
  calWeekDay:{width:`${100/7}%`,textAlign:'center',fontSize:11,fontWeight:'700',color:'#94A3B8'},
  calDayRow:{flexDirection:'row',justifyContent:'space-between',marginBottom:4},
  calDay:{width:`${100/7}%`,height:44,alignItems:'center',justifyContent:'center',borderRadius:12},
  calDayTxt:{fontSize:14,color:'#1E293B',fontWeight:'600'},
  calClose:{marginTop:12,alignSelf:'flex-end',paddingHorizontal:12,paddingVertical:8},
  calCloseTxt:{fontWeight:'700',fontSize:14},

  timeCard:{width:'100%',maxWidth:380,backgroundColor:'#FFF',borderRadius:24,padding:24,shadowColor:'#000',shadowOffset:{width:0,height:12},shadowOpacity:0.22,shadowRadius:24,elevation:16},
  clockRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:16},
  clockFace:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4,flex:1},
  clockTxt:{fontSize:48,fontWeight:'800',color:'#0D1B2A'},
  stepCol:{width:52,alignItems:'center',gap:10},
  stepBtn:{width:44,height:44,borderRadius:12,alignItems:'center',justifyContent:'center',borderWidth:1.5,backgroundColor:'#F8FAFC'},
  stepTxt:{fontSize:22,fontWeight:'800'},
  ampmPill:{marginLeft:8,paddingHorizontal:10,paddingVertical:6,borderRadius:999,borderWidth:1.5,backgroundColor:'#FFF7ED'},
  ampmPillTxt:{fontWeight:'800',fontSize:14},
  ampmRow:{flexDirection:'row',justifyContent:'center',gap:12,marginBottom:14},
  ampmChip:{paddingHorizontal:26,paddingVertical:10,borderRadius:999,backgroundColor:'#F1F5F9'},
  ampmChipTxt:{fontSize:15,fontWeight:'700',color:'#475569'},
  timeFooter:{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:12},
  tCancel:{paddingHorizontal:14,paddingVertical:10},
  tCancelTxt:{fontWeight:'600',fontSize:14},
  tConfirm:{paddingHorizontal:28,paddingVertical:12,borderRadius:999},
  tConfirmTxt:{color:'#FFF',fontWeight:'700',fontSize:15},
});