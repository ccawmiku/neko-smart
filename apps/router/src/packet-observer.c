/* Router metadata observer. No packet payload is written to disk or exposed by API.
 * Independent of the proxy engine; AF_PACKET + conntrack supply separate evidence.
 * GPL-3.0-or-later. */
#define _POSIX_C_SOURCE 200809L
#include <arpa/inet.h>
#include <errno.h>
#include <net/ethernet.h>
#include <net/if.h>
#include <netpacket/packet.h>
#include <linux/filter.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#define CAPACITY 2048
#define HELLO_LIMIT 4096
#define RECEIVE_LIMIT 8192
typedef struct {
 char source[46],destination[46],domain[256],kind[24];
 uint16_t sport,dport; uint8_t protocol,scope,ech,offered_tls13,complete;
 int family,ifindex; uint32_t seq; unsigned used,length;
 uint64_t bytes,packets; time_t first,last;
 unsigned char data[HELLO_LIMIT],present[HELLO_LIMIT];
} Flow;
static Flow flows[CAPACITY];
static unsigned long long packets,unparsed,evicted,fragments,drops,errors;
static volatile sig_atomic_t stopping;
static int wan_index,lan_indexes[32],lan_count;
static uint16_t be16(const unsigned char *p) {return (uint16_t)((p[0]<<8)|p[1]);}
static uint32_t be32(const unsigned char *p) {return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static double monotonic(void) {struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}
static double cpu_time(void) {struct timespec t;clock_gettime(CLOCK_PROCESS_CPUTIME_ID,&t);return t.tv_sec+t.tv_nsec/1e9;}
static void stop(int sig) {(void)sig;stopping=1;}
static int lan(int index) {for(int i=0;i<lan_count;i++)if(lan_indexes[i]==index)return 1;return 0;}
static void domain_copy(char *target,const unsigned char *value,size_t length) {
 if(length>253)return;
 for(size_t i=0;i<length;i++) {unsigned char c=value[i]; if(c<33||c>126)return;}
 memcpy(target,value,length);target[length]=0;
}
/* Return consumed encoded bytes, with bounded DNS compression-pointer traversal. */
static size_t dns_name(const unsigned char *p,size_t n,size_t start,char *out) {
 size_t pos=start,length=0,consumed=0;int jumped=0,hops=0;
 while(pos<n&&hops++<128) {
  unsigned c=p[pos++];if(!jumped)consumed++;
  if(!c){out[length]=0;return consumed;}
  if((c&0xc0)==0xc0) {if(pos>=n)return 0;unsigned offset=((c&63)<<8)|p[pos];if(!jumped)consumed++;if(offset>=n)return 0;pos=offset;jumped=1;continue;}
  if(c>63||pos+c>n||length+c+1>253)return 0;
  if(length)out[length++]='.';
  for(unsigned i=0;i<c;i++){unsigned char v=p[pos+i];if(v<33||v>126)return 0;out[length++]=(char)v;}
  pos+=c;if(!jumped)consumed+=c;
 }return 0;
}
static void parse_dns(Flow *f,const unsigned char *p,size_t n) {
 if(n<12||!be16(p+4))return;
 char name[256]={0};
 if(dns_name(p,n,12,name)){strcpy(f->domain,name);strcpy(f->kind,"plaintext-dns");f->complete=1;}
}
static int decode_client_hello(Flow *f,const unsigned char *p,size_t n) {
 if(n<42||p[0]!=1)return 0;
 size_t end=4+(((size_t)p[1]<<16)|((size_t)p[2]<<8)|p[3]);
 if(end>n)return 0;
 size_t pos=38;
 size_t length=p[pos++];if(pos+length+2>end)return 0;pos+=length;
 length=be16(p+pos);pos+=2;if(pos+length+1>end)return 0;pos+=length;
 length=p[pos++];if(pos+length>end)return 0;pos+=length;
 if(pos==end)return 1;
 if(pos+2>end)return 0;
 size_t ext_end=pos+2+be16(p+pos);pos+=2;if(ext_end>end)return 0;
 while(pos+4<=ext_end) {
  unsigned type=be16(p+pos);size_t len=be16(p+pos+2);pos+=4;if(pos+len>ext_end)return 0;
  if(type==0&&len>=5){size_t s=pos+2,list_end=s+be16(p+pos);if(list_end>pos+len)return 0;while(s+3<=list_end){unsigned kind=p[s++];size_t l=be16(p+s);s+=2;if(s+l>list_end)return 0;if(kind==0)domain_copy(f->domain,p+s,l);s+=l;}}
  if(type==0xfe0d)f->ech=1; /* Offered, never claim ECH was accepted. */
  if(type==43&&len>=3){size_t l=p[pos];if(l+1>len)return 0;for(size_t j=pos+1;j+1<pos+1+l;j+=2)if(be16(p+j)==0x0304)f->offered_tls13=1;}
  pos+=len;
 }return pos==ext_end;
}
static int client_hello(Flow *f,const unsigned char *p,size_t n) {
 Flow decoded={0};
 if(!decode_client_hello(&decoded,p,n))return 0;
 memcpy(f->domain,decoded.domain,sizeof(f->domain));f->ech=decoded.ech;f->offered_tls13=decoded.offered_tls13;
 return 1;
}
static void parse_tcp(Flow *f,const unsigned char *p,size_t n,uint32_t sequence) {
 if(f->complete||!n)return;
 if(!f->used){if(p[0]!=22){
   const char *methods[]={"GET ","POST ","HEAD ","PUT ","DELETE ","OPTIONS ","PATCH ","CONNECT "};int http=0;
   for(unsigned i=0;i<sizeof(methods)/sizeof(methods[0]);i++)if(n>=strlen(methods[i])&&!memcmp(p,methods[i],strlen(methods[i])))http=1;
   if(http){strcpy(f->kind,"plaintext-http");for(size_t j=0;j+7<n;j++)if((j==0||p[j-1]=='\n')&&!strncasecmp((const char*)p+j,"Host:",5)){size_t a=j+5,b;while(a<n&&(p[a]==' '||p[a]=='\t'))a++;for(b=a;b<n&&p[b]!='\r'&&p[b]!='\n';b++);domain_copy(f->domain,p+a,b-a);break;}f->complete=1;}
   return;
  }f->used=1;f->seq=sequence;strcpy(f->kind,"tls-incomplete");}
 int32_t offset=(int32_t)(sequence-f->seq);if(offset<0||offset>=HELLO_LIMIT)return;
 size_t copy=n;if(copy>HELLO_LIMIT-(unsigned)offset)copy=HELLO_LIMIT-(unsigned)offset;
 memcpy(f->data+offset,p,copy);memset(f->present+offset,1,copy);
 size_t contiguous=0;while(contiguous<HELLO_LIMIT&&f->present[contiguous])contiguous++;f->length=(unsigned)contiguous;
 unsigned char hello[HELLO_LIMIT];size_t accumulated=0,pos=0;
 while(pos+5<=contiguous&&f->data[pos]==22) {
  size_t len=be16(f->data+pos+3);if(pos+5+len>contiguous)return;if(accumulated+len>sizeof(hello))return;
  memcpy(hello+accumulated,f->data+pos+5,len);accumulated+=len;pos+=5+len;
  if(accumulated>=4&&accumulated>=4+(((size_t)hello[1]<<16)|((size_t)hello[2]<<8)|hello[3])){
   if(client_hello(f,hello,accumulated)){strcpy(f->kind,"tls-clienthello");f->complete=1;memset(f->data,0,sizeof(f->data));memset(f->present,0,sizeof(f->present));}return;
  }
 }
}
static Flow *find_flow(int family,const char *src,const char *dst,unsigned sport,unsigned dport,unsigned proto,unsigned scope,int index,time_t now) {
 uint32_t hash=2166136261U;for(const char *s=src;*s;s++)hash=(hash^(unsigned char)*s)*16777619U;for(const char *s=dst;*s;s++)hash=(hash^(unsigned char)*s)*16777619U;
 hash=(hash^sport)*16777619U;hash=(hash^dport)*16777619U;hash=(hash^proto)*16777619U;hash=(hash^scope)*16777619U;hash=(hash^(unsigned)index)*16777619U;
 size_t start=(hash%(CAPACITY/8))*8,empty=CAPACITY,oldest=start;
 for(size_t i=start;i<start+8;i++){
  Flow *f=&flows[i];if(!f->first){if(empty==CAPACITY)empty=i;continue;}
  if(f->family==family&&f->sport==sport&&f->dport==dport&&f->protocol==proto&&f->scope==scope&&f->ifindex==index&&!strcmp(f->source,src)&&!strcmp(f->destination,dst))return f;
  if(f->last<flows[oldest].last)oldest=i;
 }
 if(empty==CAPACITY){empty=oldest;evicted++;}Flow *f=&flows[empty];memset(f,0,sizeof(*f));
 strcpy(f->source,src);strcpy(f->destination,dst);f->family=family;f->sport=sport;f->dport=dport;f->protocol=proto;f->scope=scope;f->ifindex=index;f->first=f->last=now;
 strcpy(f->kind,proto==6?"tcp-unknown":proto==17?(dport==443?"quic-uninspected":dport==853?"encrypted-dns-candidate":"udp-unknown"):"other");return f;
}
static void observe(const unsigned char *p,size_t n,size_t total,int index,int outgoing) {
 unsigned scope=index==wan_index&&outgoing?1:lan(index)&&!outgoing?2:0;if(!scope)return;
 packets++;if(n<20){unparsed++;return;}unsigned version=p[0]>>4,protocol;size_t pos;
 char source[46]={0},destination[46]={0};int family;
 if(version==4){family=AF_INET;pos=(p[0]&15)*4;if(pos<20||pos>n){unparsed++;return;}protocol=p[9];inet_ntop(family,p+12,source,sizeof(source));inet_ntop(family,p+16,destination,sizeof(destination));if(be16(p+6)&0x3fff){fragments++;return;}}
 else if(version==6){if(n<40){unparsed++;return;}family=AF_INET6;pos=40;protocol=p[6];inet_ntop(family,p+8,source,sizeof(source));inet_ntop(family,p+24,destination,sizeof(destination));int hops=0;
  while(protocol==0||protocol==43||protocol==60||protocol==51){if(pos+2>n||hops++>8){unparsed++;return;}unsigned next=p[pos];size_t len=protocol==51?(p[pos+1]+2)*4:(p[pos+1]+1)*8;if(pos+len>n){unparsed++;return;}pos+=len;protocol=next;}
  if(protocol==44){fragments++;return;}}
 else {unparsed++;return;}
 unsigned sport=0,dport=0;if(protocol==6||protocol==17){if(pos+4>n){unparsed++;return;}sport=be16(p+pos);dport=be16(p+pos+2);}
 Flow *f=find_flow(family,source,destination,sport,dport,protocol,scope,index,time(NULL));f->last=time(NULL);f->bytes+=total;f->packets++;
 if(protocol==17&&pos+8<=n&&dport==53)parse_dns(f,p+pos+8,n-pos-8);
 if(protocol==6&&pos+20<=n){size_t header=(p[pos+12]>>4)*4;if(header<20||pos+header>n)return;uint32_t seq=be32(p+pos+4)+(!!(p[pos+13]&2));
  if(dport==53&&pos+header+2<=n){size_t l=be16(p+pos+header);if(l<=n-pos-header-2)parse_dns(f,p+pos+header+2,l);}
  else parse_tcp(f,p+pos+header,n-pos-header,seq);}
}
static void quote(FILE *fp,const char *text){fputc('"',fp);for(const unsigned char *p=(const unsigned char*)text;*p;p++){if(*p=='"'||*p=='\\')fputc('\\',fp);if(*p<32)fprintf(fp,"\\u%04x",*p);else fputc(*p,fp);}fputc('"',fp);}
static void snapshot(const char *path){char tmp[512];if(snprintf(tmp,sizeof(tmp),"%s.new",path)>=(int)sizeof(tmp))return;FILE *fp=fopen(tmp,"w");if(!fp){errors++;return;}
 fprintf(fp,"{\"timestamp\":%ld,\"capacity\":%d,\"packets\":%llu,\"dropped_packets\":%llu,\"evicted_flows\":%llu,\"unparsed_packets\":%llu,\"fragmented_packets\":%llu,\"errors\":%llu,\"flows\":[",(long)time(NULL),CAPACITY,packets,drops,evicted,unparsed,fragments,errors);int comma=0;
 for(size_t i=0;i<CAPACITY;i++){Flow *f=&flows[i];if(!f->first)continue;if(time(NULL)-f->last>300){memset(f,0,sizeof(*f));continue;}if(comma++)fputc(',',fp);
  fputs("{\"source\":",fp);quote(fp,f->source);fputs(",\"destination\":",fp);quote(fp,f->destination);fputs(",\"domain\":",fp);quote(fp,f->domain);fputs(",\"protocol_evidence\":",fp);quote(fp,f->kind);
  fprintf(fp,",\"source_port\":%u,\"destination_port\":%u,\"ip_version\":%d,\"network\":\"%s\",\"vantage\":\"%s\",\"interface_index\":%d,\"ech_offered\":%s,\"tls13_offered\":%s,\"bytes\":%llu,\"packets\":%llu,\"first\":%ld,\"last\":%ld}",f->sport,f->dport,f->family==AF_INET?4:6,f->protocol==6?"tcp":f->protocol==17?"udp":"other",f->scope==1?"wan-egress":"lan-ingress",f->ifindex,f->ech?"true":"false",f->offered_tls13?"true":"false",(unsigned long long)f->bytes,(unsigned long long)f->packets,(long)f->first,(long)f->last);
 }fputs("]}",fp);if(fclose(fp)==0){if(rename(tmp,path))errors++;}else errors++;
}
#ifndef OBSERVER_TEST
static int filter_interfaces(int fd){
 struct sock_filter code[1+5*33+1];unsigned n=0;
 code[n++]=(struct sock_filter)BPF_STMT(BPF_LD|BPF_W|BPF_ABS,(unsigned)(SKF_AD_OFF+SKF_AD_IFINDEX));
 for(int i=-1;i<lan_count;i++){
  unsigned index=i<0?(unsigned)wan_index:(unsigned)lan_indexes[i];
  code[n++]=(struct sock_filter)BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,index,0,4);
  code[n++]=(struct sock_filter)BPF_STMT(BPF_LD|BPF_W|BPF_ABS,(unsigned)(SKF_AD_OFF+SKF_AD_PKTTYPE));
  code[n++]=(struct sock_filter)BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,PACKET_OUTGOING,0,1);
  code[n++]=(struct sock_filter)BPF_STMT(BPF_RET|BPF_K,i<0?RECEIVE_LIMIT:0);
  code[n++]=(struct sock_filter)BPF_STMT(BPF_RET|BPF_K,i<0?0:RECEIVE_LIMIT);
 }
 code[n++]=(struct sock_filter)BPF_STMT(BPF_RET|BPF_K,0);
 struct sock_fprog program={(unsigned short)n,code};return setsockopt(fd,SOL_SOCKET,SO_ATTACH_FILTER,&program,sizeof(program));
}
int main(int argc,char **argv){if(argc!=4){fprintf(stderr,"Usage: %s WAN_IF LAN_IFS_CSV SNAPSHOT_PATH\n",argv[0]);return 2;}
 wan_index=(int)if_nametoindex(argv[1]);if(!wan_index){fprintf(stderr,"WAN interface unavailable\n");return 2;}char *name=strtok(argv[2],",");while(name&&lan_count<32){int index=(int)if_nametoindex(name);if(index&&index!=wan_index)lan_indexes[lan_count++]=index;name=strtok(NULL,",");}
 umask(0077);struct rlimit limit={64*1024*1024,64*1024*1024};setrlimit(RLIMIT_AS,&limit);signal(SIGTERM,stop);signal(SIGINT,stop);
 int fd=socket(AF_PACKET,SOCK_DGRAM,htons(ETH_P_ALL));if(fd<0){perror("AF_PACKET");return 1;}int size=2*1024*1024;setsockopt(fd,SOL_SOCKET,SO_RCVBUF,&size,sizeof(size));
 if(filter_interfaces(fd)){perror("Interface capture filter");close(fd);return 1;}
 struct pollfd pollfd={fd,POLLIN,0};unsigned char packet[RECEIVE_LIMIT];double last=0,period=monotonic(),cpu=cpu_time();
 while(!stopping){if(poll(&pollfd,1,100)>0){for(int i=0;i<64;i++){struct sockaddr_ll addr;socklen_t len=sizeof(addr);ssize_t got=recvfrom(fd,packet,sizeof(packet),MSG_DONTWAIT|MSG_TRUNC,(struct sockaddr*)&addr,&len);if(got<0){if(errno!=EAGAIN&&errno!=EINTR)errors++;break;}observe(packet,(size_t)got>sizeof(packet)?sizeof(packet):(size_t)got,(size_t)got,addr.sll_ifindex,addr.sll_pkttype==PACKET_OUTGOING);}}
  double now=monotonic();if(now-last>=5){struct {unsigned packets,drops;} stats;socklen_t size_stats=sizeof(stats);if(!getsockopt(fd,SOL_PACKET,PACKET_STATISTICS,&stats,&size_stats))drops+=stats.drops;snapshot(argv[3]);last=now;}
  if(now-period>=.1){period=now;cpu=cpu_time();}else if(cpu_time()-cpu>.020){struct timespec pause={0,(long)((.1-(now-period))*1e9)};nanosleep(&pause,NULL);period=monotonic();cpu=cpu_time();}
 }snapshot(argv[3]);close(fd);return 0;
}
#endif
