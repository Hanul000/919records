export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#fff8f4] px-6 py-16 text-[#2f2018] sm:px-10">
      <article className="mx-auto max-w-2xl">
        <p className="text-sm font-medium text-[#db6f31]">919 기록물 업로드</p>
        <h1 className="mt-3 text-3xl font-semibold">개인정보처리방침</h1>
        <p className="mt-8 leading-7">
          이 페이지는 919 기록물 수집을 위해 제공됩니다. 업로드 시 입력한 이름, 파일 이름과 파일 내용은
          기록물을 수집·정리하고 보관하기 위한 목적으로만 처리됩니다.
        </p>
        <p className="mt-5 leading-7">
          파일은 제출자의 Google Drive가 아닌 기록물 관리자의 Google Drive에 직접 업로드됩니다.
          업로드용 접근 코드를 아는 사람은 이 페이지를 이용할 수 있습니다.
        </p>
        <p className="mt-5 leading-7">
          제출된 기록물은 링크를 가진 사람이 열람할 수 있는 보관함에 저장됩니다. 민감한 개인정보나
          공개되어서는 안 되는 파일은 업로드하지 마세요.
        </p>
        <p className="mt-5 leading-7">
          Google Drive 연결 권한은 이 서비스가 만든 업로드 폴더와 파일을 관리하는 데에만 사용됩니다.
        </p>
      </article>
    </main>
  );
}
