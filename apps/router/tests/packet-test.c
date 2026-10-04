#define OBSERVER_TEST
#include "../src/packet-observer.c"
#include <assert.h>

int main(void) {
 Flow f={0};unsigned char hello[256]={1,0,0,63,3,3};
 hello[39]=0;hello[40]=2;hello[41]=0x13;hello[42]=1;hello[43]=1;hello[44]=0;
 hello[45]=0;hello[46]=20;hello[47]=0;hello[48]=0;hello[49]=0;hello[50]=16;
 hello[51]=0;hello[52]=14;hello[53]=0;hello[54]=0;hello[55]=11;memcpy(hello+56,"example.com",11);
 assert(client_hello(&f,hello,67));assert(!strcmp(f.domain,"example.com"));assert(!f.ech);
 unsigned char record[72]={22,3,1,0,67};memcpy(record+5,hello,67);memset(&f,0,sizeof(f));
 parse_tcp(&f,record,24,1000);assert(!f.complete);
 parse_tcp(&f,record+48,24,1048);assert(!f.complete);
 parse_tcp(&f,record+24,24,1024);assert(f.complete);assert(!strcmp(f.kind,"tls-clienthello"));assert(!strcmp(f.domain,"example.com"));
 memset(&f,0,sizeof(f));record[4]=100;parse_tcp(&f,record,72,1000);assert(!f.complete);assert(!strcmp(f.kind,"tls-incomplete"));
 unsigned char dns[]={0,1,1,0,0,1,0,0,0,0,0,0,7,'e','x','a','m','p','l','e',3,'c','o','m',0,0,1,0,1};
 memset(&f,0,sizeof(f));parse_dns(&f,dns,sizeof(dns));assert(!strcmp(f.kind,"plaintext-dns"));assert(!strcmp(f.domain,"example.com"));
 unsigned char cyclic[]={0,1,1,0,0,1,0,0,0,0,0,0,0xc0,12};memset(&f,0,sizeof(f));parse_dns(&f,cyclic,sizeof(cyclic));assert(!f.complete);
 memset(&f,0,sizeof(f));const unsigned char http[]="GET /private?secret=never-export HTTP/1.1\r\nHost: example.com\r\nCookie: private\r\n\r\n";parse_tcp(&f,http,sizeof(http)-1,1);assert(!strcmp(f.kind,"plaintext-http"));assert(!strcmp(f.domain,"example.com"));
 /* Deterministic malformed-packet coverage under ASan/UBSan. */
 wan_index=1;uint32_t state=0x12345678;unsigned char packet[1024];
 for(unsigned i=0;i<30000;i++){for(unsigned j=0;j<sizeof(packet);j++){state=state*1664525U+1013904223U;packet[j]=(unsigned char)(state>>24);}size_t n=state%sizeof(packet);observe(packet,n,n,1,1);client_hello(&f,packet,n);parse_dns(&f,packet,n);}
 puts("TLS SNI, TCP reassembly, incomplete TLS, DNS, cyclic compression, HTTP metadata and malformed packets passed");return 0;
}
